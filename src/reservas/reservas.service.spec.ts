jest.mock('uuid', () => ({ v4: () => 'uuid-de-prueba' }));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from '../auth/roles';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReservasService } from './reservas.service';
import { CreacionReservaService } from './creacion-reserva.service';
import { CreateReservaPanelDto } from './dto/create-reserva-panel.dto';
import { ReservasController } from './reservas.controller';
import { ReservarController } from '../reservar/reservar.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { AbonosService } from '../pagos/abonos.service';
import { Repository } from 'typeorm';

const EMPRESA = 1;
const OTRA = 2;
const DUENO: JwtPayload = {
  sub: 9,
  email: 'd@example.com',
  rolId: ROL_ADMIN,
  empresaId: EMPRESA,
};

function montar(reservaEmpresa = EMPRESA, tipoEstado = 'Reserva') {
  const reservaRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 7,
      estado: { id: 1 },
      sucursal: { empresa: { id: reservaEmpresa } },
    }),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((r: object) => Promise.resolve(r)),
  };
  const estadoRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 2, tipo: tipoEstado }),
  };
  const sucursalRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 10, empresa: { id: reservaEmpresa } }),
  };
  const correos = { notificarCambioEstado: jest.fn() };
  const abonos = { anularVencidos: jest.fn().mockResolvedValue(0) };
  const service = new ReservasService(
    reservaRepo as unknown as Repository<Reserva>,
    estadoRepo as unknown as Repository<Estado>,
    sucursalRepo as unknown as Repository<Sucursal>,
    correos as unknown as ReservaCorreosService,
    abonos as unknown as AbonosService,
    {} as never, // servicio
    {} as never, // horario
    {} as never, // bloqueo
    {} as never, // servicioEmpleado
    {} as never, // creacion
  );
  return { service, reservaRepo, correos };
}

describe('ReservasService', () => {
  it('lista las reservas de una sucursal propia', async () => {
    const { service, reservaRepo } = montar();
    await service.findAllBySucursal(10, DUENO);
    expect(reservaRepo.find).toHaveBeenCalled();
  });

  it('SPEC 08: cada reserva trae origen y solo id y nombre de quien la agendó', async () => {
    const { service, reservaRepo } = montar();
    reservaRepo.find.mockResolvedValue([
      {
        id: 1,
        origen: 'Panel',
        usuarioCreador: { id: 4, nombre: 'Rocío', passwordHash: 'secreto' },
      },
      { id: 2, origen: 'Online', usuarioCreador: null },
    ]);
    const res = await service.findAllBySucursal(10, DUENO);
    expect(res).toEqual([
      expect.objectContaining({
        origen: 'Panel',
        usuarioCreador: { id: 4, nombre: 'Rocío' },
      }),
      expect.objectContaining({ origen: 'Online', usuarioCreador: null }),
    ]);
  });

  it('no lista reservas de otra empresa', async () => {
    const { service, reservaRepo } = montar(OTRA);
    await expect(service.findAllBySucursal(10, DUENO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reservaRepo.find).not.toHaveBeenCalled();
  });

  it('cambia el estado de una reserva propia y notifica', async () => {
    const { service, reservaRepo, correos } = montar();
    await service.actualizarEstado(7, { estadoId: 2 }, DUENO);
    expect(reservaRepo.save).toHaveBeenCalled();
    expect(correos.notificarCambioEstado).toHaveBeenCalledWith(7);
  });

  it('no cambia el estado de una reserva de otra empresa', async () => {
    const { service, reservaRepo, correos } = montar(OTRA);
    await expect(
      service.actualizarEstado(7, { estadoId: 2 }, DUENO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservaRepo.save).not.toHaveBeenCalled();
    expect(correos.notificarCambioEstado).not.toHaveBeenCalled();
  });

  it('rechaza un estado que no es de reserva', async () => {
    const { service, reservaRepo } = montar(EMPRESA, 'Usuario');
    await expect(
      service.actualizarEstado(7, { estadoId: 2 }, DUENO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reservaRepo.save).not.toHaveBeenCalled();
  });
});

describe('ReservasService: recepcionista (SPEC 08)', () => {
  const recepcionista = (sucursalId: number): JwtPayload => ({
    sub: 20,
    email: 'r@example.com',
    rolId: ROL_RECEPCIONISTA,
    empresaId: EMPRESA,
    sucursalId,
  });
  const reservaEnSucursal = (sucursalId: number) => ({
    id: 7,
    estado: { id: 1 },
    sucursal: { id: sucursalId, empresa: { id: EMPRESA } },
  });

  it('lista y cambia el estado de reservas de su sucursal', async () => {
    const { service, reservaRepo, correos } = montar();
    await service.findAllBySucursal(10, recepcionista(10));
    expect(reservaRepo.find).toHaveBeenCalled();

    reservaRepo.findOne.mockResolvedValue(reservaEnSucursal(10));
    await service.actualizarEstado(7, { estadoId: 2 }, recepcionista(10));
    expect(reservaRepo.save).toHaveBeenCalled();
    expect(correos.notificarCambioEstado).toHaveBeenCalledWith(7);
  });

  it('en otra sucursal de su empresa recibe 403', async () => {
    const { service, reservaRepo } = montar();
    await expect(
      service.findAllBySucursal(10, recepcionista(11)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservaRepo.find).not.toHaveBeenCalled();

    reservaRepo.findOne.mockResolvedValue(reservaEnSucursal(10));
    await expect(
      service.actualizarEstado(7, { estadoId: 2 }, recepcionista(11)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservaRepo.save).not.toHaveBeenCalled();
  });

  it('el listado y el cambio de estado están abiertos al rol 2', () => {
    for (const metodo of ['findAll', 'actualizarEstado']) {
      const fn = Object.getOwnPropertyDescriptor(
        ReservasController.prototype,
        metodo,
      )!.value as object;
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual([
        ROL_ADMIN,
        ROL_RECEPCIONISTA,
      ]);
    }
  });
});

describe('Acceso a las reservas', () => {
  it('el controlador privado exige sesión y rol', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ReservasController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('la API pública no expone el listado ni el cambio de estado', () => {
    const metodos = Object.getOwnPropertyNames(ReservarController.prototype);
    expect(metodos).not.toContain('getReservasBySucursal');
    expect(metodos).not.toContain('actualizarEstadoReserva');
  });
});

describe('ReservasService.proximaHora (SPEC 08)', () => {
  const SUCURSAL = 10;
  const SERVICIO = 100;
  // Viernes 2026-11-13, 10:02 en Chile (UTC-3 en noviembre).
  const AHORA = new Date('2026-11-13T13:02:00Z');
  const HOY = '2026-11-13';

  const dueno: JwtPayload = {
    sub: 1,
    email: 'd@example.com',
    rolId: ROL_ADMIN,
    empresaId: EMPRESA,
  };

  const empleado = (id: number, nombre: string) => ({
    id,
    nombre,
    apellido: 'X',
    foto: null,
    activo: true,
  });

  const reserva = (
    empleadoId: number,
    inicio: string,
    fin: string,
    estado = 'Programada',
  ) => ({
    empleado: { id: empleadoId },
    horaInicio: inicio,
    horaFin: fin,
    estado: { nombre: estado },
  });

  function montarProxima(
    opciones: {
      sucursal?: unknown;
      servicio?: unknown;
      empleados?: unknown[];
      reservas?: unknown[];
      bloqueos?: unknown[];
      horarios?: unknown[];
    } = {},
  ) {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(opciones.reservas ?? []),
    };
    const reservaRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const sucursalRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          'sucursal' in opciones
            ? opciones.sucursal
            : { id: SUCURSAL, empresa: { id: EMPRESA } },
        ),
    };
    const servicioRepo = {
      findOne: jest.fn().mockResolvedValue(
        'servicio' in opciones
          ? opciones.servicio
          : {
              id: SERVICIO,
              nombre: 'Corte',
              duracionMinutos: 30,
              activo: true,
              empresa: { id: EMPRESA },
            },
      ),
    };
    const horarioRepo = {
      find: jest
        .fn()
        .mockResolvedValue(
          opciones.horarios ?? [
            { horaInicio: '10:00:00', horaFin: '20:00:00' },
          ],
        ),
    };
    const bloqueoRepo = {
      find: jest.fn().mockResolvedValue(opciones.bloqueos ?? []),
    };
    const servicioEmpleadoRepo = {
      find: jest.fn().mockResolvedValue(
        (opciones.empleados ?? [empleado(1, 'Ana')]).map((e) => ({
          empleado: e,
        })),
      ),
    };
    const abonos = { anularVencidos: jest.fn().mockResolvedValue(0) };
    const service = new ReservasService(
      reservaRepo as never,
      {} as never,
      sucursalRepo as never,
      {} as never,
      abonos as never,
      servicioRepo as never,
      horarioRepo as never,
      bloqueoRepo as never,
      servicioEmpleadoRepo as never,
      {} as never, // creacion
    );
    return { service, abonos };
  }

  const consultar = (
    service: ReservasService,
    over: Partial<{ fecha: string }> = {},
    user: JwtPayload = dueno,
  ) =>
    service.proximaHora(
      user,
      { sucursalId: SUCURSAL, servicioId: SERVICIO, ...over },
      AHORA,
    );

  it('devuelve el primer hueco de hoy desde ahora redondeado a 5 minutos', async () => {
    const { service, abonos } = montarProxima();
    const res = await consultar(service);
    expect(res.fecha).toBe(HOY);
    expect(res.ahora).toBe('10:02');
    expect(res.empleados).toEqual([
      expect.objectContaining({
        empleadoId: 1,
        horaInicio: '10:05',
        horaFin: '10:35',
        reservasAntes: 0,
        esperaMinutos: 3,
      }),
    ]);
    expect(abonos.anularVencidos).toHaveBeenCalledWith(SUCURSAL);
  });

  it('cuenta la reserva en curso y la siguiente como "antes"', async () => {
    const { service } = montarProxima({
      reservas: [reserva(1, '09:45', '10:15'), reserva(1, '10:15', '11:00')],
    });
    const [fila] = (await consultar(service)).empleados;
    expect(fila.horaInicio).toBe('11:00');
    expect(fila.reservasAntes).toBe(2);
    expect(fila.esperaMinutos).toBe(58);
  });

  it('una reserva Completada no cuenta en la cola, pero sí ocupa su tramo', async () => {
    const { service } = montarProxima({
      reservas: [reserva(1, '10:00', '10:30', 'Completada')],
    });
    const [fila] = (await consultar(service)).empleados;
    expect(fila.horaInicio).toBe('10:30');
    expect(fila.reservasAntes).toBe(0);
  });

  it('ordena por hora y deja al final a los empleados sin cupo', async () => {
    const { service } = montarProxima({
      empleados: [empleado(1, 'Ana'), empleado(2, 'Beto'), empleado(3, 'Caro')],
      reservas: [reserva(1, '10:00', '20:00'), reserva(2, '10:00', '12:00')],
    });
    const { empleados } = await consultar(service);
    expect(empleados.map((e) => [e.empleadoId, e.horaInicio])).toEqual([
      [3, '10:05'],
      [2, '12:00'],
      [1, null],
    ]);
    expect(empleados[2]).toEqual(
      expect.objectContaining({ horaFin: null, esperaMinutos: null }),
    );
  });

  it('considera los bloqueos del empleado', async () => {
    const { service } = montarProxima({
      bloqueos: [
        { empleado: { id: 1 }, horaInicio: '10:00:00', horaFin: '13:00:00' },
      ],
    });
    const [fila] = (await consultar(service)).empleados;
    expect(fila.horaInicio).toBe('13:00');
  });

  it('en una fecha futura busca desde la apertura y no informa espera', async () => {
    const { service } = montarProxima({
      reservas: [reserva(1, '10:00', '10:30')],
    });
    const res = await consultar(service, { fecha: '2026-11-14' });
    expect(res.fecha).toBe('2026-11-14');
    expect(res.empleados[0]).toEqual(
      expect.objectContaining({
        horaInicio: '10:30',
        reservasAntes: 1,
        esperaMinutos: null,
      }),
    );
  });

  it('una fecha pasada responde 400', async () => {
    const { service } = montarProxima();
    await expect(
      consultar(service, { fecha: '2026-11-12' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un servicio de otra empresa o inactivo responde 400', async () => {
    const otro = montarProxima({
      servicio: { id: SERVICIO, activo: true, empresa: { id: OTRA } },
    });
    await expect(consultar(otro.service)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const inactivo = montarProxima({
      servicio: { id: SERVICIO, activo: false, empresa: { id: EMPRESA } },
    });
    await expect(consultar(inactivo.service)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sucursal inexistente → 404; de otra empresa → 403', async () => {
    const inexistente = montarProxima({ sucursal: null });
    await expect(consultar(inexistente.service)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const ajena = montarProxima({
      sucursal: { id: SUCURSAL, empresa: { id: OTRA } },
    });
    await expect(consultar(ajena.service)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('el recepcionista solo consulta su sucursal', async () => {
    const recepcionista: JwtPayload = {
      ...dueno,
      rolId: ROL_RECEPCIONISTA,
      sucursalId: 99,
    };
    const { service } = montarProxima();
    await expect(consultar(service, {}, recepcionista)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      consultar(service, {}, { ...recepcionista, sucursalId: SUCURSAL }),
    ).resolves.toBeDefined();
  });

  it('sin empleados que ofrezcan el servicio devuelve la lista vacía', async () => {
    const { service } = montarProxima({ empleados: [] });
    expect((await consultar(service)).empleados).toEqual([]);
  });

  it('el endpoint está abierto al rol 2 y el resto del controlador sigue solo para el rol 1', () => {
    const roles = (objetivo: object) =>
      Reflect.getMetadata(ROLES_KEY, objetivo) as number[];
    expect(
      roles(
        Object.getOwnPropertyDescriptor(
          ReservasController.prototype,
          'proximaHora',
        )!.value as object,
      ),
    ).toEqual([ROL_ADMIN, ROL_RECEPCIONISTA]);
    expect(roles(ReservasController)).toEqual([ROL_ADMIN]);
  });
});

describe('ReservasService.crearDesdePanel (SPEC 08)', () => {
  const SUCURSAL = 10;
  const SERVICIO = 100;
  const EMPLEADO = 1000;
  // Viernes 2026-11-13, 10:02 en Chile.
  const AHORA = new Date('2026-11-13T13:02:00Z');
  const HOY = '2026-11-13';

  const dueno: JwtPayload = {
    sub: 7,
    email: 'd@example.com',
    rolId: ROL_ADMIN,
    empresaId: EMPRESA,
  };

  const dto = (
    over: Partial<CreateReservaPanelDto> = {},
  ): CreateReservaPanelDto => ({
    sucursalId: SUCURSAL,
    servicioId: SERVICIO,
    empleadoId: EMPLEADO,
    fecha: HOY,
    horaInicio: '11:00',
    clienteNombre: 'Pedro',
    ...over,
  });

  function montarPanel(
    opciones: {
      sucursal?: unknown;
      solapes?: number;
      clienteExistente?: unknown;
      delDia?: unknown[];
    } = {},
  ) {
    const sucursal =
      'sucursal' in opciones
        ? opciones.sucursal
        : { id: SUCURSAL, activo: true, empresa: { id: EMPRESA } };
    const sucursalRepo = { findOne: jest.fn().mockResolvedValue(sucursal) };
    const servicioRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: SERVICIO,
        activo: true,
        precio: 12000,
        duracionMinutos: 30,
        empresa: { id: EMPRESA },
      }),
    };
    const empleadoRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: EMPLEADO,
        nombre: 'Ana',
        apellido: 'Pérez',
        activo: true,
        sucursal: { id: SUCURSAL },
      }),
    };
    const ofreceRepo = { findOne: jest.fn().mockResolvedValue({ id: 1 }) };
    const horarioRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ horaInicio: '09:00:00', horaFin: '20:00:00' }]),
    };
    const solapeQb = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(opciones.solapes ?? 0),
    };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(solapeQb),
      findOne: jest.fn((entidad: unknown) =>
        Promise.resolve(
          entidad === Estado
            ? { id: 1, nombre: 'Programada' }
            : (opciones.clienteExistente ?? null),
        ),
      ),
      create: jest.fn((_entidad: unknown, datos: object) => datos),
      save: jest.fn((datos: object) => Promise.resolve({ id: 55, ...datos })),
    };
    const dataSource = {
      transaction: jest.fn((_nivel: string, fn: (m: unknown) => unknown) =>
        fn(manager),
      ),
    };
    const creacion = new CreacionReservaService(
      sucursalRepo as never,
      servicioRepo as never,
      empleadoRepo as never,
      horarioRepo as never,
      ofreceRepo as never,
      dataSource as never,
    );
    const delDiaQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(opciones.delDia ?? []),
    };
    const reservaRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(delDiaQb),
    };
    const correos = { notificarNuevaReserva: jest.fn() };
    const abonos = {
      anularVencidos: jest.fn().mockResolvedValue(0),
      evaluarCobro: jest.fn(),
      registrarPendiente: jest.fn(),
    };
    const service = new ReservasService(
      reservaRepo as never,
      {} as never,
      sucursalRepo as never,
      correos as never,
      abonos as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      creacion,
    );
    return { service, manager, correos, abonos, dataSource };
  }

  const crear = (
    service: ReservasService,
    over: Partial<CreateReservaPanelDto> = {},
    user: JwtPayload = dueno,
  ) => service.crearDesdePanel(user, dto(over), AHORA);

  it('crea la reserva Programada, Origen Panel, con quien la agendó y sin Pago', async () => {
    const { service, manager, abonos, dataSource } = montarPanel();

    const res = await crear(service);

    expect(dataSource.transaction).toHaveBeenCalledWith(
      'SERIALIZABLE',
      expect.any(Function),
    );
    expect(manager.create).toHaveBeenCalledWith(
      Reserva,
      expect.objectContaining({
        fecha: HOY,
        horaInicio: '11:00',
        horaFin: '11:30',
        precio: 12000,
        origen: 'Panel',
        usuarioCreador: { id: 7 },
        empleado: { id: EMPLEADO },
        empresa: { id: EMPRESA },
        estado: { id: 1, nombre: 'Programada' },
      }),
    );
    expect(abonos.evaluarCobro).not.toHaveBeenCalled();
    expect(abonos.registrarPendiente).not.toHaveBeenCalled();
    expect(abonos.anularVencidos).toHaveBeenCalledWith(SUCURSAL);
    expect(res).toEqual(
      expect.objectContaining({
        id: 55,
        estado: 'Programada',
        origen: 'Panel',
        empleado: { id: EMPLEADO, nombre: 'Ana', apellido: 'Pérez' },
        cliente: { nombre: 'Pedro' },
        reservasAntes: 0,
      }),
    );
    expect(res).not.toHaveProperty('pago');
  });

  it('informa cuántas reservas tiene antes, sin contarse a sí misma', async () => {
    const reserva = (id: number, inicio: string, fin: string) => ({
      id,
      horaInicio: inicio,
      horaFin: fin,
      estado: { nombre: 'Programada' },
    });
    const { service } = montarPanel({
      delDia: [
        reserva(1, '09:45', '10:15'),
        reserva(2, '10:15', '11:00'),
        reserva(55, '11:00', '11:30'),
      ],
    });
    const res = await crear(service);
    expect(res.reservasAntes).toBe(2);
  });

  it('envía la confirmación sin aviso interno', async () => {
    const { service, correos } = montarPanel();
    await crear(service, { clienteEmail: 'pedro@example.com' });
    expect(correos.notificarNuevaReserva).toHaveBeenCalledWith(55, {
      avisoInterno: false,
    });
  });

  it('reusa el cliente de la empresa con el mismo email', async () => {
    const existente = { id: 3, email: 'pedro@example.com' };
    const { service, manager } = montarPanel({ clienteExistente: existente });
    await crear(service, { clienteEmail: 'pedro@example.com' });
    expect(manager.create).toHaveBeenCalledWith(
      Reserva,
      expect.objectContaining({ cliente: existente }),
    );
  });

  it('una hora ocupada responde 409 y no crea nada', async () => {
    const { service, manager, correos } = montarPanel({ solapes: 1 });
    await expect(crear(service)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });

  it('fuera del horario de atención responde 400', async () => {
    const { service } = montarPanel();
    await expect(
      crear(service, { horaInicio: '19:45' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una hora de hoy ya pasada responde 400; la del bloque actual de 5 min se acepta', async () => {
    const { service } = montarPanel();
    await expect(
      crear(service, { horaInicio: '09:55' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(crear(service, { horaInicio: '10:00' })).resolves.toEqual(
      expect.objectContaining({ horaInicio: '10:00' }),
    );
  });

  it('una fecha pasada responde 400', async () => {
    const { service } = montarPanel();
    await expect(
      crear(service, { fecha: '2026-11-12' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sucursal inexistente → 404; de otra empresa → 403', async () => {
    await expect(
      crear(montarPanel({ sucursal: null }).service),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      crear(
        montarPanel({
          sucursal: { id: SUCURSAL, activo: true, empresa: { id: OTRA } },
        }).service,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el recepcionista solo crea en su sucursal', async () => {
    const { service } = montarPanel();
    const recepcionista: JwtPayload = {
      ...dueno,
      rolId: ROL_RECEPCIONISTA,
      sucursalId: 99,
    };
    await expect(crear(service, {}, recepcionista)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      crear(service, {}, { ...recepcionista, sucursalId: SUCURSAL }),
    ).resolves.toBeDefined();
  });

  it('el endpoint POST /reservas está abierto a los roles 1 y 2', () => {
    const metodo = Object.getOwnPropertyDescriptor(
      ReservasController.prototype,
      'crear',
    )!.value as object;
    expect(Reflect.getMetadata(ROLES_KEY, metodo)).toEqual([
      ROL_ADMIN,
      ROL_RECEPCIONISTA,
    ]);
  });
});
