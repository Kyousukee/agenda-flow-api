import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ReembolsosService } from './reembolsos.service';
import { Pago } from './entities/pago.entity';
import { FlowError } from '../flow/flow.client';
import type { ReembolsoFlow } from '../flow/flow.client';
import { CuentaFlow } from '../flow/entities/cuenta-flow.entity';

/** Estados de tipo 'Pago' con IDs fijos, como en schema.sql. */
const ESTADOS: Record<string, number> = {
  Pendiente: 14,
  Pagado: 15,
  Rechazado: 16,
  Reembolsado: 17,
};
const NOMBRE_DE = Object.fromEntries(
  Object.entries(ESTADOS).map(([nombre, id]) => [id, nombre]),
);

const CUENTA = { id: 3, apiKey: 'KEY', secretKeyCifrada: 'x' } as CuentaFlow;

interface FilaReembolso {
  id: number;
  pagoId: number;
  monto: number;
  origen: string;
  usuarioId: number | null;
  estadoId: number;
  flowToken: string | null;
  flowRefundOrder: string | null;
  comisionFlow: number | null;
  error: string | null;
  fechaResolucion: Date | null;
}

interface FilaPago {
  id: number;
  estadoId: number;
  cuentaFlowId: number | null;
  montoNeto: number | null;
  email: string;
}

function respuestaFlow(parcial: Partial<ReembolsoFlow> = {}): ReembolsoFlow {
  return {
    token: 'RTOK',
    flowRefundOrder: 555,
    status: 'created',
    amount: 4323,
    fee: 0,
    ...parcial,
  };
}

function montar(
  opciones: {
    pago?: Partial<FilaPago>;
    reembolsos?: Partial<FilaReembolso>[];
    crearReembolso?: jest.Mock;
    estadoReembolso?: jest.Mock;
    neto?: number;
    cuenta?: CuentaFlow | null;
  } = {},
) {
  const pago: FilaPago = {
    id: 77,
    estadoId: ESTADOS.Pagado,
    cuentaFlowId: 3,
    montoNeto: opciones.neto ?? 4323,
    email: 'cliente@ejemplo.cl',
    ...opciones.pago,
  };
  let siguienteId = 1;
  const reembolsos: FilaReembolso[] = (opciones.reembolsos ?? []).map((r) => ({
    id: siguienteId++,
    pagoId: pago.id,
    monto: 1000,
    origen: 'Panel',
    usuarioId: null,
    estadoId: ESTADOS.Pendiente,
    flowToken: null,
    flowRefundOrder: null,
    comisionFlow: null,
    error: null,
    fechaResolucion: null,
    ...r,
  }));

  const conEstado = (r: FilaReembolso) => ({
    ...r,
    estado: { id: r.estadoId, nombre: NOMBRE_DE[r.estadoId] },
    pago: { id: pago.id, cuentaFlowId: pago.cuentaFlowId },
  });

  const idsDe = (filtro: unknown): number[] => {
    if (filtro instanceof FindOperator) {
      return filtro.value as number[];
    }
    return [filtro as number];
  };

  const manager = {
    query: jest.fn(() => Promise.resolve([{ EstadoId: pago.estadoId }])),
    find: jest.fn(
      (
        _entidad: unknown,
        { where }: { where: { pagoId: number; estado: { id: unknown } } },
      ) => {
        const ids = idsDe(where.estado.id);
        return Promise.resolve(
          reembolsos.filter(
            (r) => r.pagoId === where.pagoId && ids.includes(r.estadoId),
          ),
        );
      },
    ),
    findOne: jest.fn(() =>
      Promise.resolve({ id: pago.id, montoNeto: pago.montoNeto }),
    ),
    create: jest.fn((_entidad: unknown, datos: object) => datos),
    save: jest.fn(
      (datos: Partial<FilaReembolso> & { estado: { id: number } }) => {
        const { estado, ...resto } = datos;
        const fila = {
          ...(resto as FilaReembolso),
          id: siguienteId++,
          estadoId: estado.id,
        };
        reembolsos.push(fila);
        return Promise.resolve({ ...fila, estado });
      },
    ),
    createQueryBuilder: jest.fn(() => {
      const registro = {
        entidad: null as unknown,
        set: {} as Record<string, unknown>,
        params: {} as Record<string, number>,
      };
      const qb = {
        update: (e: unknown) => ((registro.entidad = e), qb),
        set: (v: Record<string, unknown>) => ((registro.set = v), qb),
        where: (_: string, p: Record<string, number>) => (
          Object.assign(registro.params, p),
          qb
        ),
        andWhere: (_: string, p: Record<string, number>) => (
          Object.assign(registro.params, p),
          qb
        ),
        execute: () => {
          const { id, igualA } = registro.params;
          const { estado, ...extra } = registro.set as {
            estado: { id: number };
          };
          if (registro.entidad === Pago) {
            if (igualA !== undefined && pago.estadoId !== igualA) {
              return Promise.resolve({ affected: 0 });
            }
            pago.estadoId = estado.id;
            return Promise.resolve({ affected: 1 });
          }
          const fila = reembolsos.find((r) => r.id === id);
          if (!fila || (igualA !== undefined && fila.estadoId !== igualA)) {
            return Promise.resolve({ affected: 0 });
          }
          Object.assign(fila, extra, { estadoId: estado.id });
          return Promise.resolve({ affected: 1 });
        },
      };
      return qb;
    }),
    transaction: jest.fn(),
  };
  // Se asigna aparte: dentro del literal, la referencia a `manager` lo tipaba como any.
  manager.transaction.mockImplementation((fn: (m: unknown) => unknown) =>
    fn(manager),
  );

  const pagoRepo = {
    findOne: jest.fn(() =>
      Promise.resolve({
        id: pago.id,
        cuentaFlowId: pago.cuentaFlowId,
        montoNeto: pago.montoNeto,
        estado: { id: pago.estadoId, nombre: NOMBRE_DE[pago.estadoId] },
        reserva: { id: 5, cliente: { email: pago.email } },
      }),
    ),
    manager,
  };
  const reembolsoRepo = {
    update: jest.fn((id: number, patch: object) => {
      Object.assign(
        reembolsos.find((r) => r.id === id)!,
        patch,
      );
      return Promise.resolve(undefined);
    }),
    findOne: jest.fn(
      ({ where }: { where: { id?: number; flowToken?: string } }) => {
        const fila = reembolsos.find((r) =>
          where.flowToken !== undefined
            ? r.flowToken === where.flowToken
            : r.id === where.id,
        );
        return Promise.resolve(fila ? conEstado(fila) : null);
      },
    ),
    find: jest.fn(({ where }: { where: { pagoId: number } }) =>
      Promise.resolve(
        reembolsos
          .filter(
            (r) =>
              r.pagoId === where.pagoId && r.estadoId === ESTADOS.Pendiente,
          )
          .map(conEstado),
      ),
    ),
  };
  const estadoRepo = {
    findOne: jest.fn(({ where }: { where: { nombre: string } }) =>
      Promise.resolve({ id: ESTADOS[where.nombre], ...where }),
    ),
  };
  const abonos = {
    asegurarMontoNeto: jest.fn(() => Promise.resolve(pago.montoNeto ?? 0)),
  };
  const cuentasFlow = {
    buscarPorId: jest
      .fn()
      .mockResolvedValue('cuenta' in opciones ? opciones.cuenta : CUENTA),
    credenciales: jest
      .fn()
      .mockReturnValue({ apiKey: 'KEY', secretKey: 'SECRET' }),
  };
  const flow = {
    crearReembolso:
      opciones.crearReembolso ??
      jest.fn((_c: unknown, datos: { amount: number }) =>
        Promise.resolve(respuestaFlow({ amount: datos.amount })),
      ),
    estadoReembolso:
      opciones.estadoReembolso ??
      jest.fn().mockResolvedValue(respuestaFlow({ status: 'refunded' })),
    urlPublica: jest.fn((ruta: string) => `https://api.ejemplo.cl/${ruta}`),
  };

  const correos = { notificarReembolsoRechazado: jest.fn() };
  const service = new ReembolsosService(
    pagoRepo as never,
    reembolsoRepo as never,
    estadoRepo as never,
    abonos as never,
    cuentasFlow as never,
    flow as never,
    correos as never,
  );
  return {
    service,
    pago,
    reembolsos,
    flow,
    abonos,
    manager,
    cuentasFlow,
    correos,
  };
}

describe('ReembolsosService.solicitar', () => {
  it('total: sin monto reembolsa todo el neto con la cuenta que firmó el cobro', async () => {
    const { service, reembolsos, flow, cuentasFlow } = montar();

    const resultado = await service.solicitar({
      pagoId: 77,
      origen: 'Cliente',
    });

    expect(resultado).toEqual({ id: 1, monto: 4323, estado: 'Pendiente' });
    expect(cuentasFlow.buscarPorId).toHaveBeenCalledWith(3);
    expect(flow.crearReembolso).toHaveBeenCalledWith(
      { apiKey: 'KEY', secretKey: 'SECRET' },
      {
        refundCommerceOrder: 'RF-1',
        receiverEmail: 'cliente@ejemplo.cl',
        amount: 4323,
        urlCallBack: 'https://api.ejemplo.cl/flow/reembolso/confirmacion',
        commerceTrxId: 'R-77',
      },
    );
    expect(reembolsos[0]).toMatchObject({
      monto: 4323,
      origen: 'Cliente',
      usuarioId: null,
      estadoId: ESTADOS.Pendiente,
      flowToken: 'RTOK',
      flowRefundOrder: '555',
      comisionFlow: 0,
    });
  });

  it('bloquea la fila del pago con UPDLOCK antes de calcular el reembolsable', async () => {
    const { service, manager } = montar();
    await service.solicitar({ pagoId: 77, origen: 'Panel', usuarioId: 9 });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('WITH (UPDLOCK, HOLDLOCK)'),
      [77],
    );
  });

  it('parcial: descuenta los reembolsos Pendiente y Reembolsado, no los Rechazado', async () => {
    const { service, flow } = montar({
      reembolsos: [
        { monto: 1000, estadoId: ESTADOS.Reembolsado },
        { monto: 500, estadoId: ESTADOS.Pendiente },
        { monto: 2000, estadoId: ESTADOS.Rechazado },
      ],
    });

    const resultado = await service.solicitar({
      pagoId: 77,
      origen: 'Panel',
      usuarioId: 9,
    });

    expect(resultado.monto).toBe(4323 - 1500);
    expect(flow.crearReembolso).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 2823 }),
    );
  });

  it('un monto mayor al reembolsable responde 400 y no llama a Flow', async () => {
    const { service, flow, reembolsos } = montar({
      reembolsos: [{ monto: 4000, estadoId: ESTADOS.Reembolsado }],
    });

    await expect(
      service.solicitar({ pagoId: 77, monto: 400, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(flow.crearReembolso).not.toHaveBeenCalled();
    expect(reembolsos).toHaveLength(1);
  });

  it('montos no enteros o menores que 1 responden 400', async () => {
    for (const monto of [0, -5, 10.5]) {
      const { service } = montar();
      await expect(
        service.solicitar({ pagoId: 77, monto, origen: 'Panel' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('sin saldo por reembolsar responde 400', async () => {
    const { service } = montar({
      reembolsos: [{ monto: 4323, estadoId: ESTADOS.Pendiente }],
    });
    await expect(
      service.solicitar({ pagoId: 77, origen: 'Cliente' }),
    ).rejects.toThrow('El pago no tiene saldo por reembolsar');
  });

  it('un pago manual (sin cuenta Flow) responde 400', async () => {
    const { service } = montar({ pago: { cuentaFlowId: null } });
    await expect(
      service.solicitar({ pagoId: 77, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un pago que no está Pagado responde 400', async () => {
    const { service } = montar({ pago: { estadoId: ESTADOS.Pendiente } });
    await expect(
      service.solicitar({ pagoId: 77, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un pago inexistente responde 404', async () => {
    const { service, manager } = montar();
    const pagoRepo = (
      service as unknown as { pagoRepo: { findOne: jest.Mock } }
    ).pagoRepo;
    pagoRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.solicitar({ pagoId: 1, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.transaction).not.toHaveBeenCalled();
  });

  it('si Flow falla, el reembolso queda Rechazado con el error y responde 502', async () => {
    const { service, reembolsos, correos } = montar({
      crearReembolso: jest
        .fn()
        .mockRejectedValue(new FlowError('Saldo insuficiente', 400, 1001)),
    });

    await expect(
      service.solicitar({ pagoId: 77, origen: 'Cliente' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(reembolsos[0]).toMatchObject({
      estadoId: ESTADOS.Rechazado,
      error: 'Saldo insuficiente',
    });
    expect(reembolsos[0].fechaResolucion).toBeInstanceOf(Date);
    // Quien llamó recibe el 502 en el momento: no es un rechazo tardío y no se avisa por correo.
    expect(correos.notificarReembolsoRechazado).not.toHaveBeenCalled();
  });

  it('un reembolso rechazado libera su monto: el reintento puede pedir todo de nuevo', async () => {
    const crearReembolso = jest
      .fn()
      .mockRejectedValueOnce(new FlowError('Saldo insuficiente'))
      .mockImplementation((_c: unknown, datos: { amount: number }) =>
        Promise.resolve(respuestaFlow({ amount: datos.amount })),
      );
    const { service } = montar({ crearReembolso });

    await expect(
      service.solicitar({ pagoId: 77, origen: 'Cliente' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      service.solicitar({ pagoId: 77, origen: 'Panel' }),
    ).resolves.toMatchObject({ monto: 4323 });
  });

  it('si Flow responde rejected al crearlo, queda Rechazado y responde 502', async () => {
    const { service, reembolsos } = montar({
      crearReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'rejected' })),
    });

    await expect(
      service.solicitar({ pagoId: 77, origen: 'Cliente' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(reembolsos[0]).toMatchObject({
      estadoId: ESTADOS.Rechazado,
      flowToken: 'RTOK',
    });
  });

  it('sin la cuenta Flow que firmó el cobro, queda Rechazado y responde 502', async () => {
    const { service, reembolsos, flow } = montar({ cuenta: null });
    await expect(
      service.solicitar({ pagoId: 77, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(flow.crearReembolso).not.toHaveBeenCalled();
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Rechazado);
  });

  it('refunded inmediato: cierra el reembolso y deja el pago Reembolsado si cubre el neto', async () => {
    const { service, reembolsos, pago } = montar({
      crearReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'refunded', fee: 120 })),
    });

    const resultado = await service.solicitar({
      pagoId: 77,
      origen: 'Cliente',
    });

    expect(resultado.estado).toBe('Reembolsado');
    expect(reembolsos[0]).toMatchObject({
      estadoId: ESTADOS.Reembolsado,
      comisionFlow: 120,
    });
    expect(pago.estadoId).toBe(ESTADOS.Reembolsado);
  });

  it('un reembolso parcial refunded deja el pago Pagado', async () => {
    const { service, pago } = montar({
      crearReembolso: jest
        .fn()
        .mockImplementation((_c: unknown, datos: { amount: number }) =>
          Promise.resolve(
            respuestaFlow({ status: 'refunded', amount: datos.amount }),
          ),
        ),
    });

    await service.solicitar({ pagoId: 77, monto: 1000, origen: 'Panel' });

    expect(pago.estadoId).toBe(ESTADOS.Pagado);
  });

  it('dos parciales refunded que suman el neto dejan el pago Reembolsado; un tercero responde 400', async () => {
    const { service, pago } = montar({
      crearReembolso: jest
        .fn()
        .mockImplementation((_c: unknown, datos: { amount: number }) =>
          Promise.resolve(
            respuestaFlow({ status: 'refunded', amount: datos.amount }),
          ),
        ),
    });

    await service.solicitar({ pagoId: 77, monto: 2000, origen: 'Panel' });
    await service.solicitar({ pagoId: 77, monto: 2323, origen: 'Panel' });
    expect(pago.estadoId).toBe(ESTADOS.Reembolsado);

    await expect(
      service.solicitar({ pagoId: 77, monto: 1, origen: 'Panel' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReembolsosService.procesarToken (webhook de Flow)', () => {
  const pendienteConToken = { monto: 4323, flowToken: 'RTOK' };

  it('refunded: Reembolso → Reembolsado y el pago → Reembolsado, sin aviso al local', async () => {
    const { service, reembolsos, pago, flow, correos } = montar({
      reembolsos: [pendienteConToken],
    });

    await expect(service.procesarToken('RTOK')).resolves.toBe('Reembolsado');
    expect(flow.estadoReembolso).toHaveBeenCalledWith(
      { apiKey: 'KEY', secretKey: 'SECRET' },
      'RTOK',
    );
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Reembolsado);
    expect(pago.estadoId).toBe(ESTADOS.Reembolsado);
    expect(correos.notificarReembolsoRechazado).not.toHaveBeenCalled();
  });

  it('rejected: avisa al local con la reserva, el monto y el motivo de Flow', async () => {
    const { service, correos } = montar({
      reembolsos: [pendienteConToken],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'rejected' })),
    });

    await service.procesarToken('RTOK');

    expect(correos.notificarReembolsoRechazado).toHaveBeenCalledWith(
      5,
      4323,
      'Flow informó rejected',
    );
  });

  it('rejected: Reembolso → Rechazado con el error y el pago sigue Pagado', async () => {
    const { service, reembolsos, pago } = montar({
      reembolsos: [pendienteConToken],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'rejected' })),
    });

    await expect(service.procesarToken('RTOK')).resolves.toBe('Rechazado');
    expect(reembolsos[0]).toMatchObject({
      estadoId: ESTADOS.Rechazado,
      error: 'Flow informó rejected',
    });
    expect(pago.estadoId).toBe(ESTADOS.Pagado);
  });

  it('canceled se trata como rechazo', async () => {
    const { service, reembolsos } = montar({
      reembolsos: [pendienteConToken],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'canceled' })),
    });
    await service.procesarToken('RTOK');
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Rechazado);
  });

  it('created o accepted no cambian nada', async () => {
    for (const status of ['created', 'accepted']) {
      const { service, reembolsos } = montar({
        reembolsos: [pendienteConToken],
        estadoReembolso: jest.fn().mockResolvedValue(respuestaFlow({ status })),
      });
      await expect(service.procesarToken('RTOK')).resolves.toBe('Pendiente');
      expect(reembolsos[0].estadoId).toBe(ESTADOS.Pendiente);
    }
  });

  it('doble callback: el segundo no repite la transición ni el correo', async () => {
    const { service, reembolsos, manager, correos } = montar({
      reembolsos: [pendienteConToken],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'rejected' })),
    });
    const errorLog = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await service.procesarToken('RTOK');
    const primeraResolucion = reembolsos[0].fechaResolucion;
    await expect(service.procesarToken('RTOK')).resolves.toBe('Rechazado');

    expect(reembolsos[0].fechaResolucion).toBe(primeraResolucion);
    // El aviso del rechazo tardío sale una sola vez.
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(correos.notificarReembolsoRechazado).toHaveBeenCalledTimes(1);
    expect(manager.transaction).toHaveBeenCalledTimes(2);
  });

  it('un monto distinto al guardado no cambia nada', async () => {
    const { service, reembolsos } = montar({
      reembolsos: [pendienteConToken],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'refunded', amount: 99 })),
    });
    await expect(service.procesarToken('RTOK')).resolves.toBe('Pendiente');
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Pendiente);
  });

  it('un token desconocido responde 404', async () => {
    const { service } = montar({ reembolsos: [pendienteConToken] });
    await expect(service.procesarToken('OTRO')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ReembolsosService.refrescarPendientes', () => {
  it('consulta solo los pendientes con token y aplica el resultado', async () => {
    const { service, reembolsos, flow } = montar({
      reembolsos: [
        { monto: 1000, flowToken: 'A' },
        { monto: 1000, flowToken: null },
        { monto: 1000, flowToken: 'B', estadoId: ESTADOS.Reembolsado },
      ],
      estadoReembolso: jest
        .fn()
        .mockResolvedValue(respuestaFlow({ status: 'refunded', amount: 1000 })),
    });

    await service.refrescarPendientes(77);

    expect(flow.estadoReembolso).toHaveBeenCalledTimes(1);
    expect(flow.estadoReembolso).toHaveBeenCalledWith(expect.anything(), 'A');
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Reembolsado);
    expect(reembolsos[1].estadoId).toBe(ESTADOS.Pendiente);
  });

  it('si Flow falla, deja el reembolso como estaba y no lanza', async () => {
    const { service, reembolsos } = montar({
      reembolsos: [{ monto: 1000, flowToken: 'A' }],
      estadoReembolso: jest.fn().mockRejectedValue(new FlowError('caído')),
    });

    await expect(service.refrescarPendientes(77)).resolves.toBeUndefined();
    expect(reembolsos[0].estadoId).toBe(ESTADOS.Pendiente);
  });
});

describe('ReembolsosService: consultas del panel', () => {
  function montarConsultas(filas: object[]) {
    const reembolsoRepo = { find: jest.fn().mockResolvedValue(filas) };
    const estadoRepo = {
      findOne: jest.fn(({ where }: { where: { nombre: string } }) =>
        Promise.resolve({ id: ESTADOS[where.nombre], ...where }),
      ),
    };
    const service = new ReembolsosService(
      {} as never,
      reembolsoRepo as never,
      estadoRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, reembolsoRepo };
  }

  it('historial: más reciente primero, con montos numéricos y el estado con su color', async () => {
    const fecha = new Date('2026-11-12T10:00:00Z');
    const { service, reembolsoRepo } = montarConsultas([
      {
        id: 2,
        monto: '1000.00',
        origen: 'Panel',
        estado: { id: 16, nombre: 'Rechazado', color: '#c0392b' },
        comisionFlow: null,
        error: 'Saldo insuficiente',
        fechaCreacion: fecha,
        fechaResolucion: fecha,
      },
    ]);

    await expect(service.historial(77)).resolves.toEqual([
      {
        id: 2,
        monto: 1000,
        origen: 'Panel',
        estado: { id: 16, nombre: 'Rechazado', color: '#c0392b' },
        comisionFlow: null,
        error: 'Saldo insuficiente',
        fechaCreacion: fecha,
        fechaResolucion: fecha,
      },
    ]);
    expect(reembolsoRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pagoId: 77 },
        order: { fechaCreacion: 'DESC', id: 'DESC' },
      }),
    );
  });

  it('reembolsadoPorPago suma solo los Reembolsado de cada pago', async () => {
    const { service, reembolsoRepo } = montarConsultas([
      { pagoId: 3, monto: '1000.00' },
      { pagoId: 3, monto: '500.00' },
      { pagoId: 4, monto: '200.00' },
    ]);

    const totales = await service.reembolsadoPorPago([3, 4, 5]);

    expect([...totales.entries()]).toEqual([
      [3, 1500],
      [4, 200],
    ]);
    const { where } = (
      reembolsoRepo.find.mock.calls[0] as [
        { where: { pagoId: FindOperator<number[]>; estado: { id: number } } },
      ]
    )[0];
    expect(where.pagoId.value).toEqual([3, 4, 5]);
    expect(where.estado).toEqual({ id: ESTADOS.Reembolsado });
  });

  it('reembolsadoPorPago sin pagos no consulta la BD', async () => {
    const { service, reembolsoRepo } = montarConsultas([]);
    await expect(service.reembolsadoPorPago([])).resolves.toEqual(new Map());
    expect(reembolsoRepo.find).not.toHaveBeenCalled();
  });
});
