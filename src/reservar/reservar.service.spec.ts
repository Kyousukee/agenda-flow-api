jest.mock('uuid', () => ({ v4: () => 'uuid-de-prueba' }));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservarService } from './reservar.service';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Cliente } from '../clientes/entities/cliente.entity';

const EMPRESA = 1;
const SUCURSAL = 10;
const SERVICIO = 100;
const EMPLEADO = 1000;

const manana = () =>
  new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

function dto(over: Partial<CreateReservaDto> = {}): CreateReservaDto {
  return {
    empresaId: EMPRESA,
    sucursalId: SUCURSAL,
    servicioId: SERVICIO,
    empleadoId: EMPLEADO,
    fecha: manana(),
    horaInicio: '10:00',
    clienteNombre: 'Cliente',
    clienteEmail: 'cliente@example.com',
    ...over,
  };
}

function montar(
  opciones: {
    sucursal?: unknown;
    servicio?: unknown;
    empleado?: unknown;
    ofrece?: unknown;
    solapes?: number;
    horarios?: unknown[];
  } = {},
) {
  const repo = (valor: unknown) => ({
    findOne: jest.fn().mockResolvedValue(valor),
  });
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(opciones.solapes ?? 0),
  };
  const manager = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_entity: unknown, datos: object) => datos),
    save: jest.fn((datos: object) =>
      Promise.resolve({ id: 5, ...datos, cliente: { email: 'privado' } }),
    ),
  };
  const dataSource = {
    transaction: jest.fn((_nivel: string, fn: (m: unknown) => unknown) =>
      fn(manager),
    ),
  };
  const correos = { notificarNuevaReserva: jest.fn() };
  const horarioRepo = {
    find: jest
      .fn()
      .mockResolvedValue(
        opciones.horarios ?? [{ horaInicio: '09:00:00', horaFin: '18:00:00' }],
      ),
  };

  const service = new (ReservarService as unknown as new (
    ...args: unknown[]
  ) => ReservarService)(
    {}, // reserva
    repo(
      'sucursal' in opciones
        ? opciones.sucursal
        : { id: SUCURSAL, activo: true, empresa: { id: EMPRESA } },
    ),
    repo(
      'servicio' in opciones
        ? opciones.servicio
        : {
            id: SERVICIO,
            activo: true,
            precio: 15000,
            duracionMinutos: 45,
            empresa: { id: EMPRESA },
          },
    ),
    repo(
      'empleado' in opciones
        ? opciones.empleado
        : { id: EMPLEADO, activo: true, sucursal: { id: SUCURSAL } },
    ),
    horarioRepo,
    {}, // bloqueo
    repo('ofrece' in opciones ? opciones.ofrece : { id: 1 }),
    {}, // empresaSlug
    {}, // empresa
    dataSource,
    {}, // suscripciones
    correos,
  );
  return { service, manager, correos, dataSource, horarioRepo };
}

describe('ReservarService.createReserva', () => {
  it('calcula precio y hora de término en el servidor', async () => {
    const { service, manager } = montar();

    const res = await service.createReserva(dto());

    expect(res.precio).toBe(15000);
    expect(res.horaFin).toBe('10:45');
    expect(manager.create).toHaveBeenCalledWith(
      Reserva,
      expect.objectContaining({ precio: 15000, horaFin: '10:45' }),
    );
  });

  it('no devuelve los datos del cliente en la respuesta pública', async () => {
    const { service } = montar();

    const res = await service.createReserva(dto());

    expect(res).not.toHaveProperty('cliente');
  });

  it('usa un nivel de aislamiento que impide la doble reserva concurrente', async () => {
    const { service, dataSource } = montar();

    await service.createReserva(dto());

    expect(dataSource.transaction).toHaveBeenCalledWith(
      'SERIALIZABLE',
      expect.any(Function),
    );
  });

  it('busca al cliente dentro de la empresa de la reserva', async () => {
    const { service, manager } = montar();

    await service.createReserva(dto());

    expect(manager.findOne).toHaveBeenCalledWith(Cliente, {
      where: { email: 'cliente@example.com', empresa: { id: EMPRESA } },
    });
  });

  it.each([
    ['sucursal de otra empresa', { sucursal: { activo: true, empresa: { id: 2 } } }],
    ['sucursal inactiva', { sucursal: { activo: false, empresa: { id: EMPRESA } } }],
    ['servicio de otra empresa', { servicio: { activo: true, empresa: { id: 2 } } }],
    ['servicio inexistente', { servicio: null }],
    ['empleado de otra sucursal', { empleado: { activo: true, sucursal: { id: 99 } } }],
    ['empleado que no ofrece el servicio', { ofrece: null }],
  ])('rechaza %s', async (_caso, opciones) => {
    const { service, dataSource } = montar(opciones);

    await expect(service.createReserva(dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rechaza una fecha pasada', async () => {
    const { service } = montar();

    await expect(
      service.createReserva(dto({ fecha: '2020-01-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un servicio que terminaría al día siguiente', async () => {
    const { service } = montar();

    await expect(
      service.createReserva(dto({ horaInicio: '23:50' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('horario de atención', () => {
    it.each([
      ['antes de abrir', '08:30'],
      ['termina después de cerrar', '17:30'],
    ])('rechaza una reserva que %s', async (_caso, horaInicio) => {
      const { service, dataSource } = montar();

      await expect(
        service.createReserva(dto({ horaInicio })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('acepta una reserva que termina justo al cerrar', async () => {
      const { service } = montar();

      const res = await service.createReserva(dto({ horaInicio: '17:15' }));

      expect(res.horaFin).toBe('18:00');
    });

    it('rechaza un día sin horario abierto', async () => {
      const { service } = montar({ horarios: [] });

      await expect(service.createReserva(dto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('acepta el segundo tramo cuando el día tiene varios', async () => {
      const { service } = montar({
        horarios: [
          { horaInicio: '09:00:00', horaFin: '09:30:00' },
          { horaInicio: '10:00:00', horaFin: '13:00:00' },
        ],
      });

      await expect(service.createReserva(dto())).resolves.toBeDefined();
    });

    it.each([
      ['2030-01-06', 7, 'domingo'],
      ['2030-01-07', 1, 'lunes'],
    ])('%s se busca como día %i (%s)', async (fecha, diaSemana) => {
      const { service, horarioRepo } = montar();

      await service.createReserva(dto({ fecha }));

      expect(horarioRepo.find).toHaveBeenCalledWith({
        where: { sucursal: { id: SUCURSAL }, diaSemana, abierto: true },
      });
    });
  });

  it('responde 409 si la hora ya está tomada y no envía correo', async () => {
    const { service, correos, manager } = montar({ solapes: 1 });

    await expect(service.createReserva(dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });
});
