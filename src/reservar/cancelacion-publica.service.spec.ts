import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CancelacionPublicaService } from './cancelacion-publica.service';
import { hashToken } from '../auth/token-cuenta';

const TOKEN = 'a'.repeat(64);

interface ConsultaUpdate {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  execute: jest.Mock;
}

const ESTADOS: Record<string, number> = {
  Programada: 1,
  Completada: 2,
  Cancelada: 5,
};

function montar(
  opciones: {
    estado?: string;
    /** Estado al volver a leer la reserva ya con el lock (doble clic). */
    estadoConLock?: string;
    fecha?: string;
    plazoHoras?: number | null;
    pago?: object | null;
    reembolsable?: number;
    solicitar?: jest.Mock;
    lock?: number;
    afectados?: number;
    existe?: boolean;
  } = {},
) {
  const reservaBase = (estado: string) => ({
    id: 5,
    fecha: opciones.fecha ?? '2099-01-10',
    horaInicio: '10:00:00',
    estado: { id: ESTADOS[estado], nombre: estado },
    servicio: { nombre: 'Corte' },
    sucursal: { nombre: 'Casa Matriz' },
    empresa: { id: 1, nombre: 'Barbería SpA', nombreComercial: 'Barbería' },
    cliente: { email: 'carlos@email.com', telefono: '977777777' },
  });
  const reservaRepo = {
    findOne: jest.fn(
      ({
        where,
      }: {
        where: { id?: number; tokenCancelacionHash?: string };
      }) => {
        if (opciones.existe === false) {
          return Promise.resolve(null);
        }
        if (where.tokenCancelacionHash !== undefined) {
          return Promise.resolve(
            where.tokenCancelacionHash === hashToken(TOKEN)
              ? reservaBase(opciones.estado ?? 'Programada')
              : null,
          );
        }
        return Promise.resolve(
          reservaBase(
            opciones.estadoConLock ?? opciones.estado ?? 'Programada',
          ),
        );
      },
    ),
    manager: {
      createQueryBuilder: jest.fn((): ConsultaUpdate => {
        const qb: ConsultaUpdate = {
          update: jest.fn(),
          set: jest.fn(),
          where: jest.fn(),
          andWhere: jest.fn(),
          execute: jest
            .fn()
            .mockResolvedValue({ affected: opciones.afectados ?? 1 }),
        };
        for (const metodo of ['update', 'set', 'where', 'andWhere'] as const) {
          qb[metodo].mockReturnValue(qb);
        }
        actualizaciones.push(qb);
        return qb;
      }),
    },
  };
  const actualizaciones: ConsultaUpdate[] = [];
  const estadoRepo = {
    findOne: jest.fn(({ where }: { where: { nombre: string } }) =>
      Promise.resolve({ id: ESTADOS[where.nombre], ...where }),
    ),
  };
  const configRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        opciones.plazoHoras === null
          ? null
          : { tiempoCancelacionHoras: opciones.plazoHoras ?? 24 },
      ),
  };
  const pagoRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        'pago' in opciones ? opciones.pago : { id: 77, cuentaFlowId: 3 },
      ),
  };
  const reembolsos = {
    reembolsable: jest.fn().mockResolvedValue(opciones.reembolsable ?? 4323),
    solicitar:
      opciones.solicitar ??
      jest.fn().mockResolvedValue({ id: 1, monto: 4323, estado: 'Pendiente' }),
  };
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn(() => {
      runner.isTransactionActive = true;
      return Promise.resolve();
    }),
    query: jest.fn().mockResolvedValue([{ resultado: opciones.lock ?? 0 }]),
    isTransactionActive: false,
    rollbackTransaction: jest.fn(() => {
      runner.isTransactionActive = false;
      return Promise.resolve();
    }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = { createQueryRunner: jest.fn(() => runner) };

  const correos = { notificarCancelacionCliente: jest.fn() };
  const service = new CancelacionPublicaService(
    reservaRepo as never,
    estadoRepo as never,
    configRepo as never,
    pagoRepo as never,
    reembolsos as never,
    dataSource as never,
    correos as never,
  );
  return {
    service,
    correos,
    reservaRepo,
    reembolsos,
    runner,
    actualizaciones,
    pagoRepo,
  };
}

describe('CancelacionPublicaService.consultar (GET)', () => {
  it('dentro del plazo con abono: puede cancelar y muestra el reembolsable', async () => {
    const { service, reservaRepo } = montar();

    const vista = await service.consultar(TOKEN);

    expect(reservaRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenCancelacionHash: hashToken(TOKEN) },
      }),
    );
    expect(vista).toEqual({
      reserva: {
        fecha: '2099-01-10',
        horaInicio: '10:00',
        servicio: 'Corte',
        sucursal: 'Casa Matriz',
        empresa: 'Barbería',
        estado: 'Programada',
      },
      puedeCancelar: true,
      motivo: null,
      // 2099-01-10 10:00 en Chile (UTC-3) menos 24 h.
      limite: new Date('2099-01-09T13:00:00.000Z'),
      plazoHoras: 24,
      reembolso: { monto: 4323 },
    });
  });

  it('no devuelve datos del cliente', async () => {
    const { service } = montar();
    const texto = JSON.stringify(await service.consultar(TOKEN));
    expect(texto).not.toContain('carlos@email.com');
    expect(texto).not.toContain('977777777');
  });

  it('fuera del plazo: FUERA_DE_PLAZO', async () => {
    const { service } = montar({ fecha: '2020-01-10' });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      puedeCancelar: false,
      motivo: 'FUERA_DE_PLAZO',
    });
  });

  it('ya cancelada: YA_CANCELADA', async () => {
    const { service } = montar({ estado: 'Cancelada' });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      puedeCancelar: false,
      motivo: 'YA_CANCELADA',
    });
  });

  it('otro estado (Completada): NO_CANCELABLE', async () => {
    const { service } = montar({ estado: 'Completada' });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      puedeCancelar: false,
      motivo: 'NO_CANCELABLE',
    });
  });

  it('sin abono Flow pagado: reembolso null', async () => {
    const { service } = montar({ pago: null });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      puedeCancelar: true,
      reembolso: null,
    });
  });

  it('con el abono ya reembolsado completo: reembolso null', async () => {
    const { service } = montar({ reembolsable: 0 });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      reembolso: null,
    });
  });

  it('sin configuración usa 24 horas', async () => {
    const { service } = montar({ plazoHoras: null });
    await expect(service.consultar(TOKEN)).resolves.toMatchObject({
      plazoHoras: 24,
    });
  });

  it('un token desconocido responde 404', async () => {
    const { service } = montar();
    await expect(service.consultar('b'.repeat(64))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un token con formato inválido responde 404 sin consultar la BD', async () => {
    const { service, reservaRepo } = montar();
    for (const token of ['corto', 'A'.repeat(64), `${'a'.repeat(63)}'`]) {
      await expect(service.consultar(token)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(reservaRepo.findOne).not.toHaveBeenCalled();
  });
});

describe('CancelacionPublicaService.cancelar (POST)', () => {
  it('con abono: pide el reembolso como Cliente y cancela la reserva Programada', async () => {
    const { service, reembolsos, actualizaciones } = montar();

    await expect(service.cancelar(TOKEN)).resolves.toEqual({
      estado: 'Cancelada',
      reembolso: { monto: 4323, estado: 'Pendiente' },
    });
    // Sin monto: solicitar reembolsa todo lo reembolsable, calculado con el pago bloqueado.
    expect(reembolsos.solicitar).toHaveBeenCalledWith({
      pagoId: 77,
      origen: 'Cliente',
    });
    expect(actualizaciones).toHaveLength(1);
    expect(actualizaciones[0].set).toHaveBeenCalledWith({
      estado: { id: ESTADOS.Cancelada },
    });
    expect(actualizaciones[0].andWhere).toHaveBeenCalledWith(
      'EstadoId = :igualA',
      { igualA: ESTADOS.Programada },
    );
  });

  it('pide el reembolso antes de cancelar', async () => {
    const { service, reembolsos, actualizaciones } = montar();
    await service.cancelar(TOKEN);
    const ordenSolicitar = reembolsos.solicitar.mock.invocationCallOrder[0];
    const qb = actualizaciones[0];
    expect(ordenSolicitar).toBeLessThan(qb.execute.mock.invocationCallOrder[0]);
  });

  it('toma el lock de la reserva y lo libera al terminar', async () => {
    const { service, runner } = montar();

    await service.cancelar(TOKEN);

    expect(runner.startTransaction).toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('sp_getapplock'),
      ['cancelacion-reserva-5', expect.any(Number)],
    );
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('sin abono: cancela sin pedir reembolso', async () => {
    const { service, reembolsos } = montar({ pago: null });
    await expect(service.cancelar(TOKEN)).resolves.toEqual({
      estado: 'Cancelada',
      reembolso: null,
    });
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
  });

  it('con el abono ya reembolsado completo desde el panel: cancela sin pedir otro', async () => {
    const { service, reembolsos } = montar({ reembolsable: 0 });
    await expect(service.cancelar(TOKEN)).resolves.toMatchObject({
      reembolso: null,
    });
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
  });

  it('fuera del plazo: 409 FUERA_DE_PLAZO y no toca nada', async () => {
    const { service, reembolsos, actualizaciones, runner } = montar({
      fecha: '2020-01-10',
    });

    const error = await service.cancelar(TOKEN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      motivo: 'FUERA_DE_PLAZO',
    });
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
    expect(actualizaciones).toHaveLength(0);
    expect(runner.release).toHaveBeenCalled();
  });

  it('si Flow no acepta el reembolso: 502 y la reserva sigue Programada', async () => {
    const { service, actualizaciones, runner } = montar({
      solicitar: jest
        .fn()
        .mockRejectedValue(new BadGatewayException('Flow no aceptó')),
    });

    await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(actualizaciones).toHaveLength(0);
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('doble clic: el segundo, ya con el lock, ve la reserva Cancelada y responde 409 sin otro reembolso', async () => {
    const { service, reembolsos } = montar({ estadoConLock: 'Cancelada' });

    const error = await service.cancelar(TOKEN).catch((e: unknown) => e);

    expect((error as ConflictException).getResponse()).toMatchObject({
      motivo: 'YA_CANCELADA',
    });
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
  });

  it('si no se obtiene el lock a tiempo: 503 sin tocar nada', async () => {
    const { service, reembolsos, runner } = montar({ lock: -1 });
    await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(reembolsos.solicitar).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });

  it('si el estado cambió justo antes del UPDATE: 409 YA_CANCELADA', async () => {
    const { service } = montar({ afectados: 0, pago: null });
    await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('un token desconocido responde 404 sin tomar el lock', async () => {
    const { service, runner } = montar({ existe: false });
    await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(runner.connect).not.toHaveBeenCalled();
  });
});

describe('CancelacionPublicaService: correos (SPEC 07)', () => {
  it('con abono: avisa al cliente con el monto reembolsado', async () => {
    const { service, correos } = montar();
    await service.cancelar(TOKEN);
    expect(correos.notificarCancelacionCliente).toHaveBeenCalledWith(5, 4323);
  });

  it('sin abono: avisa la cancelación sin reembolso', async () => {
    const { service, correos } = montar({ pago: null });
    await service.cancelar(TOKEN);
    expect(correos.notificarCancelacionCliente).toHaveBeenCalledWith(5, null);
  });

  it('si Flow no acepta el reembolso, no se envía nada', async () => {
    const { service, correos } = montar({
      solicitar: jest
        .fn()
        .mockRejectedValue(new BadGatewayException('Flow no aceptó')),
    });
    await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(correos.notificarCancelacionCliente).not.toHaveBeenCalled();
  });

  it('fuera del plazo o ya cancelada, no se envía nada', async () => {
    for (const opciones of [
      { fecha: '2020-01-10' },
      { estadoConLock: 'Cancelada' },
      { afectados: 0, pago: null },
    ]) {
      const { service, correos } = montar(opciones);
      await expect(service.cancelar(TOKEN)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(correos.notificarCancelacionCliente).not.toHaveBeenCalled();
    }
  });
});
