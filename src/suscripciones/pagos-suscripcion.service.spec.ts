import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PagosSuscripcionService } from './pagos-suscripcion.service';
import { PagoSuscripcion } from './entities/pago-suscripcion.entity';
import { FlowError } from '../flow/flow.client';

const CREDENCIALES = { apiKey: 'AF-KEY', secretKey: 'AF-SECRET' };

function montar(
  opciones: {
    credenciales?: typeof CREDENCIALES | null;
    vigente?: { plan: string; fechaFin: Date | null };
    crearPago?: jest.Mock;
    status?: number;
    amount?: number;
    commerceOrder?: string;
    afectados?: number[];
    pago?: unknown;
    estadoFinal?: string;
    extension?: { finAnterior: Date | null; finNuevo: Date | null };
  } = {},
) {
  const afectados = [...(opciones.afectados ?? [1])];
  const updates: { set: Record<string, unknown>; params: object }[] = [];
  const manager = {
    createQueryBuilder: jest.fn(() => {
      const registro = { set: {}, params: {} };
      const qb = {
        update: () => qb,
        set: (v: Record<string, unknown>) => ((registro.set = v), qb),
        where: (_: string, p: object) => (
          Object.assign(registro.params, p),
          qb
        ),
        andWhere: (_: string, p: object) => (
          Object.assign(registro.params, p),
          qb
        ),
        execute: () => {
          updates.push(registro);
          return Promise.resolve({ affected: afectados.shift() ?? 0 });
        },
      };
      return qb;
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const pago =
    'pago' in opciones
      ? opciones.pago
      : { id: 12, empresaId: 1, monto: '19990.00', dias: 30 };
  const pagoRepo = {
    create: jest.fn((datos: object) => datos),
    save: jest.fn((datos: object) => Promise.resolve({ id: 12, ...datos })),
    update: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(({ where }: { where: { flowToken?: string } }) =>
      Promise.resolve(
        where.flowToken !== undefined
          ? pago
          : { estado: { nombre: opciones.estadoFinal ?? 'Pagado' } },
      ),
    ),
    manager: {
      transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
    },
  };
  const estadoRepo = {
    findOne: jest.fn(({ where }: { where: { nombre: string } }) =>
      Promise.resolve({ id: `Pago-${where.nombre}`, nombre: where.nombre }),
    ),
  };
  const suscripciones = {
    obtenerVigente: jest
      .fn()
      .mockResolvedValue(
        opciones.vigente ?? { plan: 'Gratis', fechaFin: null },
      ),
    extenderPro: jest.fn().mockResolvedValue(
      opciones.extension ?? {
        finAnterior: null,
        finNuevo: new Date('2026-12-10T12:00:00Z'),
      },
    ),
  };
  const flow = {
    credencialesAgendaFlow:
      'credenciales' in opciones ? opciones.credenciales : CREDENCIALES,
    urlPublica: jest.fn((ruta: string) => `https://api.ejemplo.cl/${ruta}`),
    crearPago:
      opciones.crearPago ??
      jest.fn().mockResolvedValue({
        url: 'https://flow/pay',
        token: 'TOK',
        flowOrder: 555,
        urlPago: 'https://flow/pay?token=TOK',
      }),
    obtenerEstado: jest.fn().mockResolvedValue({
      status: opciones.status ?? 2,
      amount: opciones.amount ?? 19990,
      commerceOrder: opciones.commerceOrder ?? 'S-12',
      flowOrder: 555,
      paymentData: { date: '2026-11-10 12:00:00' },
    }),
  };
  const service = new PagosSuscripcionService(
    pagoRepo as never,
    estadoRepo as never,
    suscripciones as never,
    flow as never,
  );
  return { service, pagoRepo, suscripciones, flow, updates, manager };
}

describe('PagosSuscripcionService.iniciar', () => {
  it('crea un pago Pendiente de $19.990 / 30 días y el cobro con la cuenta de AgendaFlow', async () => {
    const { service, pagoRepo, flow } = montar();

    await expect(service.iniciar(1, 'duena@negocio.cl')).resolves.toEqual({
      urlPago: 'https://flow/pay?token=TOK',
      pagoId: 12,
    });

    expect(pagoRepo.create).toHaveBeenCalledWith({
      empresaId: 1,
      monto: 19990,
      dias: 30,
      estado: expect.objectContaining({ nombre: 'Pendiente' }) as object,
    });
    expect(flow.crearPago).toHaveBeenCalledWith(CREDENCIALES, {
      commerceOrder: 'S-12',
      subject: 'AgendaFlow Pro - 30 días',
      amount: 19990,
      email: 'duena@negocio.cl',
      urlConfirmation: 'https://api.ejemplo.cl/flow/suscripcion/confirmacion',
      urlReturn: 'https://api.ejemplo.cl/flow/suscripcion/retorno',
    });
    expect(pagoRepo.update).toHaveBeenCalledWith(12, {
      flowToken: 'TOK',
      flowOrder: '555',
    });
  });

  it('con Pro sin vencimiento responde 409', async () => {
    const { service, pagoRepo } = montar({
      vigente: { plan: 'Pro', fechaFin: null },
    });
    await expect(service.iniciar(1, 'x@y.cl')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('sin FLOW_API_KEY responde 503', async () => {
    const { service } = montar({ credenciales: null });
    await expect(service.iniciar(1, 'x@y.cl')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('si Flow falla, marca el pago Rechazado y responde 502', async () => {
    const { service, pagoRepo } = montar({
      crearPago: jest.fn().mockRejectedValue(new FlowError('caído')),
    });
    await expect(service.iniciar(1, 'x@y.cl')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(pagoRepo.update).toHaveBeenCalledWith(12, {
      estado: expect.objectContaining({ nombre: 'Rechazado' }) as object,
    });
  });
});

describe('PagosSuscripcionService.procesarToken', () => {
  it('pagado: marca Pagado, extiende Pro 30 días y guarda FinAnterior/FinNuevo', async () => {
    const fin = new Date('2026-12-10T12:00:00Z');
    const { service, suscripciones, updates, manager, flow } = montar({
      extension: { finAnterior: null, finNuevo: fin },
    });

    await expect(service.procesarToken('TOK')).resolves.toBe('pagado');

    expect(flow.obtenerEstado).toHaveBeenCalledWith(CREDENCIALES, 'TOK');
    expect(updates[0].params).toMatchObject({
      id: 12,
      distintoDe: 'Pago-Pagado',
    });
    expect(suscripciones.extenderPro).toHaveBeenCalledWith(1, 30, manager);
    expect(manager.update).toHaveBeenCalledWith(PagoSuscripcion, 12, {
      finAnterior: null,
      finNuevo: fin,
    });
  });

  it('una doble confirmación extiende una sola vez', async () => {
    const { service, suscripciones } = montar({ afectados: [0] });
    await service.procesarToken('TOK');
    expect(suscripciones.extenderPro).not.toHaveBeenCalled();
  });

  it('rechazado: Pendiente → Rechazado sin extender', async () => {
    const { service, suscripciones, updates } = montar({
      status: 3,
      estadoFinal: 'Rechazado',
    });
    await expect(service.procesarToken('TOK')).resolves.toBe('rechazado');
    expect((updates[0].set.estado as { id: string }).id).toBe('Pago-Rechazado');
    expect(updates[0].params).toMatchObject({ igualA: 'Pago-Pendiente' });
    expect(suscripciones.extenderPro).not.toHaveBeenCalled();
  });

  it('un monto distinto no cambia nada', async () => {
    const { service, updates, suscripciones } = montar({
      amount: 100,
      estadoFinal: 'Pendiente',
    });
    await expect(service.procesarToken('TOK')).resolves.toBe('pendiente');
    expect(updates).toHaveLength(0);
    expect(suscripciones.extenderPro).not.toHaveBeenCalled();
  });

  it('una orden de abono (R-) no se acepta como mensualidad', async () => {
    const { service, updates } = montar({ commerceOrder: 'R-12' });
    await service.procesarToken('TOK');
    expect(updates).toHaveLength(0);
  });

  it('un token desconocido responde 404', async () => {
    const { service } = montar({ pago: null });
    await expect(service.procesarToken('NO')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
