import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { PagosService } from './pagos.service';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReembolsosService } from './reembolsos.service';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { PagosController } from './pagos.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from '../auth/roles';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const EMPRESA = 1;
const OTRA = 2;
// SPEC 08: los servicios reciben el JWT completo, no solo la empresa.
const DUENO = { sub: 9, email: 'd@example.com', rolId: 1, empresaId: EMPRESA };

function montar(
  duena = OTRA,
  estado: object | null = { id: 15, tipo: 'Pago', nombre: 'Pagado' },
  opciones: {
    cuentaFlowId?: number | null;
    solicitar?: jest.Mock;
    canceladas?: number;
  } = {},
) {
  const sucursal = { id: 10, empresa: { id: duena } };
  const pagoRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 3,
      cuentaFlowId: opciones.cuentaFlowId ?? null,
      reserva: { id: 7, sucursal },
    }),
    create: jest.fn((p: object) => p),
    save: jest.fn((p: object) => Promise.resolve(p)),
    createQueryBuilder: jest.fn(),
  };
  const cancelacion = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest
      .fn()
      .mockResolvedValue({ affected: opciones.canceladas ?? 1 }),
  };
  const reservaRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 7,
      sucursal,
      estado: { nombre: 'Programada' },
    }),
    createQueryBuilder: jest.fn(() => cancelacion),
  };
  const estadoRepo = {
    findOne: jest.fn().mockResolvedValue(estado),
    find: jest.fn().mockResolvedValue([
      {
        id: 14,
        nombre: 'Pendiente',
        color: '#f39c12',
        tipo: 'Pago',
        orden: 1,
      },
    ]),
  };
  const sucursalRepo = { findOne: jest.fn().mockResolvedValue(sucursal) };
  const reembolsos = {
    solicitar:
      opciones.solicitar ??
      jest.fn().mockResolvedValue({ id: 1, monto: 4323, estado: 'Pendiente' }),
    refrescarPendientes: jest.fn().mockResolvedValue(undefined),
    historial: jest.fn().mockResolvedValue([{ id: 1 }]),
    reembolsadoPorPago: jest.fn().mockResolvedValue(new Map()),
  };
  const correos = { notificarReembolso: jest.fn() };
  const service = new PagosService(
    pagoRepo as unknown as Repository<Pago>,
    reservaRepo as unknown as Repository<Reserva>,
    estadoRepo as unknown as Repository<Estado>,
    sucursalRepo as unknown as Repository<Sucursal>,
    reembolsos as unknown as ReembolsosService,
    correos as unknown as ReservaCorreosService,
  );
  return {
    service,
    pagoRepo,
    estadoRepo,
    reservaRepo,
    reembolsos,
    cancelacion,
    correos,
  };
}

describe('PagosService: aislamiento entre empresas', () => {
  it('no crea pagos en reservas de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(
      service.create(
        { reservaId: 7, monto: 1, fechaPago: '2030-01-01' },
        DUENO,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('no cambia el estado de pagos de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(
      service.actualizarEstado(3, { estadoId: 2 }, DUENO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('no lista pagos de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(service.findAllBySucursal(10, DUENO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pagoRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('permite operar sobre pagos propios', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    await service.actualizarEstado(3, { estadoId: 2 }, DUENO);
    expect(pagoRepo.save).toHaveBeenCalled();
  });
});

describe('PagosService: estados', () => {
  const pagoNuevo = { reservaId: 7, monto: 1, fechaPago: '2030-01-01' };

  it('registra el pago como Pagado si no se indica estado', async () => {
    const { service, pagoRepo, estadoRepo } = montar(EMPRESA);

    await service.create(pagoNuevo, DUENO);

    expect(estadoRepo.findOne).toHaveBeenCalledWith({
      where: { tipo: 'Pago', nombre: 'Pagado' },
    });
    expect(pagoRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: expect.objectContaining({ nombre: 'Pagado' }),
      }),
    );
  });

  it.each(['Reserva', 'Usuario', 'Empresa'])(
    'rechaza crear un pago con un estado de tipo %s',
    async (tipo) => {
      const { service, pagoRepo } = montar(EMPRESA, { id: 1, tipo });

      await expect(
        service.create({ ...pagoNuevo, estadoId: 1 }, DUENO),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pagoRepo.save).not.toHaveBeenCalled();
    },
  );

  it('rechaza cambiar un pago a un estado de otro tipo', async () => {
    const { service, pagoRepo } = montar(EMPRESA, { id: 8, tipo: 'Usuario' });

    await expect(
      service.actualizarEstado(3, { estadoId: 8 }, DUENO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('solo expone id, nombre y color del catálogo', async () => {
    const { service, estadoRepo } = montar(EMPRESA);

    const estados = await service.obtenerEstados();

    expect(estadoRepo.find).toHaveBeenCalledWith({
      where: { tipo: 'Pago', activo: true },
      order: { orden: 'ASC' },
    });
    expect(estados).toEqual([
      { id: 14, nombre: 'Pendiente', color: '#f39c12' },
    ]);
  });
});

describe('PagosService: reembolsos (SPEC 07)', () => {
  const REEMBOLSADO = { id: 17, tipo: 'Pago', nombre: 'Reembolsado' };
  const ESTADOS_TERMINADOS = [
    { id: 5, tipo: 'Reserva', nombre: 'Cancelada' },
    { id: 7, tipo: 'Reserva', nombre: 'Anulado' },
  ];

  it('no permite marcar Reembolsado a mano un pago Flow', async () => {
    const { service, pagoRepo } = montar(EMPRESA, REEMBOLSADO, {
      cuentaFlowId: 3,
    });

    await expect(
      service.actualizarEstado(3, { estadoId: 17 }, DUENO),
    ).rejects.toThrow(
      'Los pagos con Flow se reembolsan con POST /pagos/:id/reembolso',
    );
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('un pago manual se sigue marcando Reembolsado a mano', async () => {
    const { service, pagoRepo } = montar(EMPRESA, REEMBOLSADO);

    await service.actualizarEstado(3, { estadoId: 17 }, DUENO);

    expect(pagoRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ estado: REEMBOLSADO }),
    );
  });

  it('un pago Flow puede cambiar a estados distintos de Reembolsado', async () => {
    const { service, pagoRepo } = montar(
      EMPRESA,
      { id: 16, tipo: 'Pago', nombre: 'Rechazado' },
      { cuentaFlowId: 3 },
    );
    await service.actualizarEstado(3, { estadoId: 16 }, DUENO);
    expect(pagoRepo.save).toHaveBeenCalled();
  });

  it('no reembolsa pagos de otra empresa', async () => {
    const { service, reembolsos } = montar(OTRA);
    await expect(service.reembolsar(3, {}, EMPRESA, 9)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
  });

  it('pide el reembolso como Panel con el usuario y no toca la reserva sin el flag', async () => {
    const { service, reembolsos, reservaRepo } = montar(EMPRESA);

    const resultado = await service.reembolsar(3, { monto: 1000 }, EMPRESA, 9);

    expect(reembolsos.solicitar).toHaveBeenCalledWith({
      pagoId: 3,
      monto: 1000,
      origen: 'Panel',
      usuarioId: 9,
    });
    expect(reservaRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      reembolso: { id: 1, monto: 4323, estado: 'Pendiente' },
      reserva: { estado: 'Programada' },
    });
  });

  it('con cancelarReserva, pasa la reserva a Cancelada salvo si ya está Cancelada o Anulado', async () => {
    const { service, estadoRepo, reservaRepo, cancelacion } = montar(EMPRESA);
    estadoRepo.find.mockResolvedValueOnce(ESTADOS_TERMINADOS);
    reservaRepo.findOne.mockResolvedValueOnce({
      id: 7,
      estado: { nombre: 'Cancelada' },
    });

    const resultado = await service.reembolsar(
      3,
      { cancelarReserva: true },
      EMPRESA,
      9,
    );

    expect(cancelacion.set).toHaveBeenCalledWith({ estado: { id: 5 } });
    expect(cancelacion.where).toHaveBeenCalledWith('Id = :reservaId', {
      reservaId: 7,
    });
    expect(cancelacion.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT IN'),
      { terminados: [5, 7] },
    );
    expect(resultado.reserva).toEqual({ estado: 'Cancelada' });
  });

  it('si Flow no acepta el reembolso, responde 502 y no cancela la reserva', async () => {
    const { service, reservaRepo } = montar(EMPRESA, undefined, {
      solicitar: jest
        .fn()
        .mockRejectedValue(new BadGatewayException('Flow no aceptó')),
    });

    await expect(
      service.reembolsar(3, { cancelarReserva: true }, EMPRESA, 9),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(reservaRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('el historial refresca los pendientes antes de listar', async () => {
    const { service, reembolsos } = montar(EMPRESA);

    await expect(service.listarReembolsos(3, EMPRESA)).resolves.toEqual([
      { id: 1 },
    ]);
    expect(reembolsos.refrescarPendientes).toHaveBeenCalledWith(3);
    expect(
      reembolsos.refrescarPendientes.mock.invocationCallOrder[0],
    ).toBeLessThan(reembolsos.historial.mock.invocationCallOrder[0]);
  });

  it('no muestra el historial de pagos de otra empresa', async () => {
    const { service, reembolsos } = montar(OTRA);
    await expect(service.listarReembolsos(3, EMPRESA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reembolsos.refrescarPendientes).not.toHaveBeenCalled();
  });

  it('GET /pagos agrega montoNeto y montoReembolsado', async () => {
    const { service, pagoRepo, reembolsos } = montar(EMPRESA);
    const consulta = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { id: 3, montoNeto: '4323.00' },
        { id: 4, montoNeto: null },
      ]),
    };
    pagoRepo.createQueryBuilder.mockReturnValue(consulta);
    reembolsos.reembolsadoPorPago.mockResolvedValue(new Map([[3, 1000]]));

    const pagos = await service.findAllBySucursal(10, DUENO);

    expect(reembolsos.reembolsadoPorPago).toHaveBeenCalledWith([3, 4]);
    expect(pagos).toEqual([
      { id: 3, montoNeto: 4323, montoReembolsado: 1000 },
      { id: 4, montoNeto: null, montoReembolsado: 0 },
    ]);
  });
});

describe('PagosService: correo al cliente al reembolsar (SPEC 07)', () => {
  it('sin cancelar: avisa el reembolso con la variante sin cancelación', async () => {
    const { service, correos } = montar(EMPRESA);
    await service.reembolsar(3, { monto: 1000 }, EMPRESA, 9);
    expect(correos.notificarReembolso).toHaveBeenCalledWith(7, 4323, false);
  });

  it('cancelando: avisa el reembolso y la cancelación', async () => {
    const { service, correos, estadoRepo } = montar(EMPRESA);
    estadoRepo.find.mockResolvedValueOnce([
      { id: 5, tipo: 'Reserva', nombre: 'Cancelada' },
      { id: 7, tipo: 'Reserva', nombre: 'Anulado' },
    ]);
    await service.reembolsar(3, { cancelarReserva: true }, EMPRESA, 9);
    expect(correos.notificarReembolso).toHaveBeenCalledWith(7, 4323, true);
  });

  it('si la reserva ya estaba Cancelada o Anulado, el correo no dice que se canceló ahora', async () => {
    const { service, correos, estadoRepo } = montar(EMPRESA, undefined, {
      canceladas: 0,
    });
    estadoRepo.find.mockResolvedValueOnce([
      { id: 5, tipo: 'Reserva', nombre: 'Cancelada' },
      { id: 7, tipo: 'Reserva', nombre: 'Anulado' },
    ]);
    await service.reembolsar(3, { cancelarReserva: true }, EMPRESA, 9);
    expect(correos.notificarReembolso).toHaveBeenCalledWith(7, 4323, false);
  });

  it('si Flow no acepta el reembolso, no se envía correo', async () => {
    const { service, correos } = montar(EMPRESA, undefined, {
      solicitar: jest
        .fn()
        .mockRejectedValue(new BadGatewayException('Flow no aceptó')),
    });
    await expect(service.reembolsar(3, {}, EMPRESA, 9)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(correos.notificarReembolso).not.toHaveBeenCalled();
  });
});

describe('PagosService: recepcionista (SPEC 08)', () => {
  const recepcionista = (sucursalId: number): JwtPayload => ({
    sub: 20,
    email: 'r@example.com',
    rolId: ROL_RECEPCIONISTA,
    empresaId: EMPRESA,
    sucursalId,
  });
  const pagoNuevo = { reservaId: 7, monto: 5000, fechaPago: '2030-01-01' };

  it('registra un pago manual en una reserva de su sucursal', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    await service.create(pagoNuevo, recepcionista(10));
    expect(pagoRepo.save).toHaveBeenCalled();
  });

  it('cambia el estado de un pago manual de su sucursal', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    await service.actualizarEstado(3, { estadoId: 15 }, recepcionista(10));
    expect(pagoRepo.save).toHaveBeenCalled();
  });

  it('lista los pagos de su sucursal', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    pagoRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });
    await expect(
      service.findAllBySucursal(10, recepcionista(10)),
    ).resolves.toEqual([]);
  });

  it('en otra sucursal de su empresa recibe 403 al crear, cambiar y listar', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    const ajeno = recepcionista(11);
    await expect(service.create(pagoNuevo, ajeno)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.actualizarEstado(3, { estadoId: 15 }, ajeno),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findAllBySucursal(10, ajeno)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pagoRepo.save).not.toHaveBeenCalled();
    expect(pagoRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('no puede cambiar el estado de un pago Flow (403); el dueño sí', async () => {
    const flow = montar(EMPRESA, undefined, { cuentaFlowId: 3 });
    await expect(
      flow.service.actualizarEstado(3, { estadoId: 15 }, recepcionista(10)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(flow.pagoRepo.save).not.toHaveBeenCalled();

    await flow.service.actualizarEstado(3, { estadoId: 15 }, DUENO);
    expect(flow.pagoRepo.save).toHaveBeenCalled();
  });

  it('el controlador abre ver, estados, registrar y cambiar estado al rol 2, pero no los reembolsos', () => {
    const roles = (metodo: string) =>
      Reflect.getMetadata(
        ROLES_KEY,
        Object.getOwnPropertyDescriptor(PagosController.prototype, metodo)!
          .value as object,
      ) as number[] | undefined;
    for (const metodo of [
      'findAll',
      'obtenerEstados',
      'create',
      'actualizarEstado',
    ]) {
      expect(roles(metodo)).toEqual([ROL_ADMIN, ROL_RECEPCIONISTA]);
    }
    for (const metodo of ['reembolsar', 'listarReembolsos']) {
      expect(roles(metodo)).toBeUndefined();
    }
    expect(Reflect.getMetadata(ROLES_KEY, PagosController)).toEqual([
      ROL_ADMIN,
    ]);
  });
});
