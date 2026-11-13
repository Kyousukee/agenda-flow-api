jest.mock('uuid', () => ({ v4: () => 'uuid-de-prueba' }));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservarService } from './reservar.service';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Cliente } from '../clientes/entities/cliente.entity';
import { AbonosService } from '../pagos/abonos.service';
import { CreacionReservaService } from '../reservas/creacion-reserva.service';

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
    cobro?: unknown;
    pagoIniciado?: unknown;
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
  // SPEC 06: por defecto la empresa no cobra al reservar.
  const abonos = {
    anularVencidos: jest.fn().mockResolvedValue(0),
    evaluarCobro: jest.fn().mockResolvedValue(opciones.cobro ?? null),
    registrarPendiente: jest.fn().mockResolvedValue({ id: 77 }),
    iniciar: jest.fn().mockResolvedValue(opciones.pagoIniciado ?? null),
  };
  const horarioRepo = {
    find: jest
      .fn()
      .mockResolvedValue(
        opciones.horarios ?? [{ horaInicio: '09:00:00', horaFin: '18:00:00' }],
      ),
  };

  const sucursalRepo = repo(
    'sucursal' in opciones
      ? opciones.sucursal
      : { id: SUCURSAL, activo: true, empresa: { id: EMPRESA } },
  );
  const servicioRepo = repo(
    'servicio' in opciones
      ? opciones.servicio
      : {
          id: SERVICIO,
          activo: true,
          precio: 15000,
          duracionMinutos: 45,
          empresa: { id: EMPRESA },
        },
  );
  const empleadoRepo = repo(
    'empleado' in opciones
      ? opciones.empleado
      : { id: EMPLEADO, activo: true, sucursal: { id: SUCURSAL } },
  );
  const ofreceRepo = repo('ofrece' in opciones ? opciones.ofrece : { id: 1 });

  // SPEC 08: la validación y la transacción viven en CreacionReservaService.
  const creacion = new CreacionReservaService(
    sucursalRepo as never,
    servicioRepo as never,
    empleadoRepo as never,
    horarioRepo as never,
    ofreceRepo as never,
    dataSource as never,
  );

  const service = new (
    ReservarService as unknown as new (...args: unknown[]) => ReservarService
  )(
    {}, // reserva
    sucursalRepo,
    servicioRepo,
    empleadoRepo,
    horarioRepo,
    {}, // bloqueo
    ofreceRepo,
    {}, // empresaSlug
    {}, // empresa
    creacion,
    {}, // suscripciones
    correos,
    abonos,
  );
  return { service, manager, correos, dataSource, horarioRepo, abonos };
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
    [
      'sucursal de otra empresa',
      { sucursal: { activo: true, empresa: { id: 2 } } },
    ],
    [
      'sucursal inactiva',
      { sucursal: { activo: false, empresa: { id: EMPRESA } } },
    ],
    [
      'servicio de otra empresa',
      { servicio: { activo: true, empresa: { id: 2 } } },
    ],
    ['servicio inexistente', { servicio: null }],
    [
      'empleado de otra sucursal',
      { empleado: { activo: true, sucursal: { id: 99 } } },
    ],
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

describe('ReservarService.createReserva con abono (SPEC 06)', () => {
  const cobro = { monto: 4500, cuenta: { id: 3 } };
  const pagoIniciado = {
    monto: 4500,
    urlPago: 'https://sandbox.flow.cl/app/web/pay.php?token=TOK',
    expiraEn: new Date('2026-11-10T15:15:00Z'),
  };

  it('sin cobro, la reserva queda Programada, pago null y los correos salen de inmediato', async () => {
    const { service, manager, correos, abonos } = montar();

    const res = await service.createReserva(dto());

    expect(res).toMatchObject({ estado: 'Programada', pago: null });
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: { tipo: 'Reserva', nombre: 'Programada' },
      }),
    );
    expect(abonos.registrarPendiente).not.toHaveBeenCalled();
    expect(correos.notificarNuevaReserva).toHaveBeenCalledWith(5);
  });

  it('pasa pagarAhora y el precio del servicio al decidir el cobro', async () => {
    const { service, abonos } = montar();
    await service.createReserva(dto({ pagarAhora: true }));
    expect(abonos.evaluarCobro).toHaveBeenCalledWith({
      empresaId: EMPRESA,
      sucursalId: SUCURSAL,
      precio: 15000,
      pagarAhora: true,
    });
  });

  it('con cobro, la reserva nace Pendiente, se registra el pago y no se envían correos', async () => {
    const { service, manager, correos, abonos } = montar({
      cobro,
      pagoIniciado,
    });

    const res = await service.createReserva(dto());

    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: { tipo: 'Reserva', nombre: 'Pendiente' },
      }),
    );
    expect(abonos.registrarPendiente).toHaveBeenCalledWith(manager, 5, cobro);
    expect(abonos.iniciar).toHaveBeenCalledWith(
      expect.objectContaining({
        pago: { id: 77 },
        reservaId: 5,
        cobro,
        email: 'cliente@example.com',
      }),
    );
    expect(res).toMatchObject({ estado: 'Pendiente', pago: pagoIniciado });
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });

  it('con cobro y sin clienteEmail responde 400 sin crear la reserva', async () => {
    const { service, manager } = montar({ cobro });

    await expect(
      service.createReserva(dto({ clienteEmail: undefined })),
    ).rejects.toThrow('El email es obligatorio para pagar online');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('si Flow falla, la respuesta trae pago null, estado Programada y los correos se envían', async () => {
    const { service, correos } = montar({ cobro, pagoIniciado: null });

    const res = await service.createReserva(dto());

    expect(res).toMatchObject({ estado: 'Programada', pago: null });
    expect(correos.notificarNuevaReserva).toHaveBeenCalledWith(5);
  });
});

describe('ReservarService: pago online público (SPEC 06)', () => {
  function montarPublico(
    opciones: {
      config?: unknown;
      plan?: string;
      cifradoDisponible?: boolean;
    } = {},
  ) {
    const config =
      'config' in opciones
        ? opciones.config
        : {
            permitePagoAnticipado: true,
            pagoObligatorio: true,
            tipoAnticipo: 'Porcentaje',
            montoAnticipo: 30,
          };
    const suscripciones = {
      obtenerVigente: jest
        .fn()
        .mockResolvedValue({ plan: opciones.plan ?? 'Pro' }),
    };
    const servicioRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 1, nombre: 'Corte', precio: 9990, duracionMinutos: 30 },
        { id: 2, nombre: 'Gratis', precio: 0, duracionMinutos: 15 },
      ]),
    };
    const empresaRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: EMPRESA,
        nombre: 'Peluquería',
        slug: 'peluqueria',
      }),
    };
    const abonos = new AbonosService(
      { findOne: jest.fn().mockResolvedValue(config) } as never,
      {} as never,
      {} as never,
      {} as never,
      suscripciones as never,
      { disponible: opciones.cifradoDisponible ?? true } as never,
      {} as never,
      {} as never,
      {} as never, // correos
    );

    const service = new (
      ReservarService as unknown as new (...args: unknown[]) => ReservarService
    )(
      {}, // reserva
      {}, // sucursal
      servicioRepo,
      {}, // empleado
      {}, // horario
      {}, // bloqueo
      {}, // servicioEmpleado
      {}, // empresaSlug
      empresaRepo,
      {}, // creacion
      suscripciones,
      {}, // correos
      abonos,
    );
    return { service, suscripciones };
  }

  it('la empresa publica la configuración de anticipo activa', async () => {
    const { service } = montarPublico();
    const empresa = await service.getEmpresaBySlug('peluqueria');
    expect(empresa.pagoOnline).toEqual({
      activo: true,
      obligatorio: true,
      tipo: 'Porcentaje',
      monto: 30,
    });
  });

  it('en Completo el monto es null', async () => {
    const { service } = montarPublico({
      config: {
        permitePagoAnticipado: true,
        pagoObligatorio: false,
        tipoAnticipo: 'Completo',
        montoAnticipo: 0,
      },
    });
    const empresa = await service.getEmpresaBySlug('peluqueria');
    expect(empresa.pagoOnline).toEqual({
      activo: true,
      obligatorio: false,
      tipo: 'Completo',
      monto: null,
    });
  });

  it.each([
    ['plan Gratis', { plan: 'Gratis' }],
    ['sin FLOW_CREDENCIALES_KEY', { cifradoDisponible: false }],
    ['anticipo desactivado', { config: { permitePagoAnticipado: false } }],
    ['sin configuración', { config: null }],
  ])('%s → pagoOnline inactivo y abono null', async (_caso, opciones) => {
    const { service } = montarPublico(opciones);
    const empresa = await service.getEmpresaBySlug('peluqueria');
    expect(empresa.pagoOnline).toEqual({
      activo: false,
      obligatorio: false,
      tipo: null,
      monto: null,
    });
    const servicios = await service.getServiciosByEmpresa(EMPRESA);
    expect(servicios.map((s) => s.abono)).toEqual([null, null]);
  });

  it('cada servicio trae su abono calculado', async () => {
    const { service } = montarPublico();
    const servicios = await service.getServiciosByEmpresa(EMPRESA);
    expect(servicios.map((s) => [s.nombre, s.abono])).toEqual([
      ['Corte', 2997],
      ['Gratis', null],
    ]);
  });

  it('getEmpresaBySlug resuelve el plan una sola vez', async () => {
    const { service, suscripciones } = montarPublico();
    await service.getEmpresaBySlug('peluqueria');
    expect(suscripciones.obtenerVigente).toHaveBeenCalledTimes(1);
  });
});
