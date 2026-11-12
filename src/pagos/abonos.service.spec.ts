import { NotFoundException } from '@nestjs/common';
import { AbonosService, METODO_PAGO_FLOW } from './abonos.service';
import type { CobroAbono } from './abonos.service';
import { Pago } from './entities/pago.entity';
import { FlowError } from '../flow/flow.client';
import { CuentaFlow } from '../flow/entities/cuenta-flow.entity';

const CUENTA = { id: 3, apiKey: 'KEY', secretKeyCifrada: 'x' } as CuentaFlow;

function montar(
  opciones: {
    config?: unknown;
    plan?: string;
    cuenta?: CuentaFlow | null;
    crearPago?: jest.Mock;
    credenciales?: jest.Mock;
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
  const pagoRepo = { update: jest.fn().mockResolvedValue(undefined) };
  const reservaRepo = { update: jest.fn().mockResolvedValue(undefined) };
  const estadoRepo = {
    findOne: jest.fn(({ where }: { where: { tipo: string; nombre: string } }) =>
      Promise.resolve({ id: `${where.tipo}-${where.nombre}`, ...where }),
    ),
  };
  const cuentasFlow = {
    resolver: jest
      .fn()
      .mockResolvedValue('cuenta' in opciones ? opciones.cuenta : CUENTA),
    credenciales:
      opciones.credenciales ??
      jest.fn().mockReturnValue({ apiKey: 'KEY', secretKey: 'SECRET' }),
  };
  const flow = {
    crearPago:
      opciones.crearPago ??
      jest.fn().mockResolvedValue({
        url: 'https://flow/pay',
        token: 'TOK',
        flowOrder: 999,
        urlPago: 'https://flow/pay?token=TOK',
      }),
    urlPublica: jest.fn((ruta: string) => `https://api.ejemplo.cl/${ruta}`),
  };

  const service = new AbonosService(
    { findOne: jest.fn().mockResolvedValue(config) } as never,
    pagoRepo as never,
    reservaRepo as never,
    estadoRepo as never,
    {
      obtenerVigente: jest
        .fn()
        .mockResolvedValue({ plan: opciones.plan ?? 'Pro' }),
    } as never,
    { disponible: true } as never,
    cuentasFlow as never,
    flow as never,
    {} as never, // correos
  );
  return { service, pagoRepo, reservaRepo, cuentasFlow, flow };
}

const datosCobro = (pagarAhora?: boolean) => ({
  empresaId: 1,
  sucursalId: 10,
  precio: 15000,
  pagarAhora,
});

describe('AbonosService.evaluarCobro', () => {
  it('con anticipo obligatorio cobra el abono con la cuenta de la sucursal', async () => {
    const { service, cuentasFlow } = montar();
    await expect(service.evaluarCobro(datosCobro())).resolves.toEqual({
      monto: 4500,
      cuenta: CUENTA,
    });
    expect(cuentasFlow.resolver).toHaveBeenCalledWith(10);
  });

  it('con pago opcional solo cobra si pagarAhora es true', async () => {
    const opcional = {
      config: {
        permitePagoAnticipado: true,
        pagoObligatorio: false,
        tipoAnticipo: 'Completo',
      },
    };
    await expect(
      montar(opcional).service.evaluarCobro(datosCobro()),
    ).resolves.toBeNull();
    await expect(
      montar(opcional).service.evaluarCobro(datosCobro(false)),
    ).resolves.toBeNull();
    await expect(
      montar(opcional).service.evaluarCobro(datosCobro(true)),
    ).resolves.toEqual({ monto: 15000, cuenta: CUENTA });
  });

  it('en plan Gratis no cobra aunque la configuración siga activa', async () => {
    const { service, cuentasFlow } = montar({ plan: 'Gratis' });
    await expect(service.evaluarCobro(datosCobro())).resolves.toBeNull();
    expect(cuentasFlow.resolver).not.toHaveBeenCalled();
  });

  it('sin cuenta Flow resoluble, se reserva sin pago', async () => {
    const { service } = montar({ cuenta: null });
    await expect(service.evaluarCobro(datosCobro())).resolves.toBeNull();
  });

  it('un abono bajo el mínimo de Flow no se cobra', async () => {
    const { service } = montar();
    await expect(
      service.evaluarCobro({ ...datosCobro(), precio: 1000 }), // 30% = 300
    ).resolves.toBeNull();
  });
});

describe('AbonosService.registrarPendiente', () => {
  it('crea un Pago Pendiente de Flow que retiene la hora 15 minutos', async () => {
    const { service } = montar();
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'pendiente' }),
      create: jest.fn((_e: unknown, datos: object) => datos),
      save: jest.fn((datos: object) => Promise.resolve({ id: 77, ...datos })),
    };
    const antes = Date.now();

    const pago = await service.registrarPendiente(manager as never, 5, {
      monto: 4500,
      cuenta: CUENTA,
    });

    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: { tipo: 'Pago', nombre: 'Pendiente' },
    });
    expect(pago).toMatchObject({
      id: 77,
      reserva: { id: 5 },
      monto: 4500,
      metodoPago: METODO_PAGO_FLOW,
      cuentaFlowId: 3,
      estado: { id: 'pendiente' },
    });
    const retencion =
      pago.fechaExpiracion!.getTime() - pago.fechaPago.getTime();
    expect(retencion).toBe(15 * 60_000);
    expect(pago.fechaPago.getTime()).toBeGreaterThanOrEqual(antes);
  });
});

describe('AbonosService.iniciar', () => {
  const cobro: CobroAbono = { monto: 4500, cuenta: CUENTA };
  const pago = {
    id: 77,
    fechaPago: new Date('2026-11-10T15:00:00Z'),
    fechaExpiracion: new Date('2026-11-10T15:15:00Z'),
  } as Pago;
  const datos = {
    pago,
    reservaId: 5,
    cobro,
    email: 'cliente@example.com',
    subject: 'Barbería - Corte',
  };

  it('crea el cobro firmado con la cuenta del local y guarda token y orden', async () => {
    const { service, flow, pagoRepo, cuentasFlow } = montar();

    const iniciado = await service.iniciar(datos);

    expect(cuentasFlow.credenciales).toHaveBeenCalledWith(CUENTA);
    expect(flow.crearPago).toHaveBeenCalledWith(
      { apiKey: 'KEY', secretKey: 'SECRET' },
      {
        commerceOrder: 'R-77',
        subject: 'Barbería - Corte',
        amount: 4500,
        email: 'cliente@example.com',
        urlConfirmation: 'https://api.ejemplo.cl/flow/abono/confirmacion',
        urlReturn: 'https://api.ejemplo.cl/flow/abono/retorno',
        timeout: 900,
      },
    );
    expect(pagoRepo.update).toHaveBeenCalledWith(77, {
      flowToken: 'TOK',
      flowOrder: '999',
    });
    expect(iniciado).toEqual({
      monto: 4500,
      urlPago: 'https://flow/pay?token=TOK',
      expiraEn: pago.fechaExpiracion,
    });
  });

  it('si Flow falla, pasa la reserva a Programada y el pago a Rechazado, y devuelve null', async () => {
    const { service, pagoRepo, reservaRepo } = montar({
      crearPago: jest
        .fn()
        .mockRejectedValue(new FlowError('Invalid signature', 401, 108)),
    });

    await expect(service.iniciar(datos)).resolves.toBeNull();

    expect(reservaRepo.update).toHaveBeenCalledWith(5, {
      estado: expect.objectContaining({
        tipo: 'Reserva',
        nombre: 'Programada',
      }) as object,
    });
    expect(pagoRepo.update).toHaveBeenCalledWith(77, {
      estado: expect.objectContaining({
        tipo: 'Pago',
        nombre: 'Rechazado',
      }) as object,
    });
  });

  it('si no se puede descifrar la cuenta (clave cambiada), también cae al fallback', async () => {
    const { service, flow, reservaRepo } = montar({
      credenciales: jest.fn(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      }),
    });

    await expect(service.iniciar(datos)).resolves.toBeNull();
    expect(flow.crearPago).not.toHaveBeenCalled();
    expect(reservaRepo.update).toHaveBeenCalled();
  });
});

describe('AbonosService.procesarToken (webhooks de Flow)', () => {
  interface Update {
    entidad: unknown;
    set: Record<string, unknown>;
    params: Record<string, unknown>;
  }

  /**
   * `afectados`: filas que devuelve cada UPDATE condicional, en orden.
   * `estadoReserva`: estado actual de la reserva cuando el UPDATE Pendiente → Programada no aplica.
   */
  function montarWebhook(
    opciones: {
      status?: number;
      amount?: number;
      commerceOrder?: string;
      afectados?: number[];
      estadoReserva?: string;
      ocupada?: boolean;
      pago?: unknown;
      cuenta?: CuentaFlow | null;
      empleado?: unknown;
    } = {},
  ) {
    const afectados = [...(opciones.afectados ?? [1, 1])];
    const updates: Update[] = [];
    const conteo = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(opciones.ocupada ? 1 : 0),
    };
    const manager = {
      createQueryBuilder: jest.fn((entidad?: unknown) => {
        if (entidad) {
          return conteo;
        }
        const registro: Update = { entidad: null, set: {}, params: {} };
        const qb = {
          update: (e: unknown) => ((registro.entidad = e), qb),
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
      findOne: jest.fn().mockResolvedValue({
        id: 5,
        estado: {
          id: `Reserva-${opciones.estadoReserva ?? 'Programada'}`,
          nombre: opciones.estadoReserva ?? 'Programada',
        },
      }),
    };
    const pago =
      'pago' in opciones
        ? opciones.pago
        : {
            id: 77,
            monto: '4500.00',
            cuentaFlowId: 3,
            estado: { nombre: 'Pendiente' },
            reserva: {
              id: 5,
              codigo: 'codigo-reserva',
              fecha: '2026-11-20',
              horaInicio: '10:00:00',
              horaFin: '10:45:00',
              empleado:
                'empleado' in opciones ? opciones.empleado : { id: 1000 },
            },
          };
    const pagoRepo = {
      findOne: jest.fn(({ where }: { where: { flowToken?: string } }) =>
        Promise.resolve(
          where.flowToken !== undefined
            ? pago
            : { estado: { nombre: 'Pagado' } },
        ),
      ),
      manager: {
        transaction: jest.fn((fn: (m: typeof manager) => unknown) =>
          fn(manager),
        ),
      },
    };
    const estadoRepo = {
      findOne: jest.fn(
        ({ where }: { where: { tipo: string; nombre: string } }) =>
          Promise.resolve({ id: `${where.tipo}-${where.nombre}`, ...where }),
      ),
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
      obtenerEstado: jest.fn().mockResolvedValue({
        status: opciones.status ?? 2,
        amount: opciones.amount ?? 4500,
        commerceOrder: opciones.commerceOrder ?? 'R-77',
        flowOrder: 999,
        paymentData: { date: '2026-11-10 12:30:00' },
      }),
    };
    const correos = { notificarNuevaReserva: jest.fn() };

    const service = new AbonosService(
      {} as never,
      pagoRepo as never,
      {} as never,
      estadoRepo as never,
      {} as never,
      { disponible: true } as never,
      cuentasFlow as never,
      flow as never,
      correos as never,
    );
    return { service, updates, correos, flow, cuentasFlow, conteo };
  }

  const estadoDe = (u: Update) => (u.set.estado as { id: string }).id;

  it('pagado: Pago → Pagado, reserva Pendiente → Programada y correos de SPEC 02', async () => {
    const { service, updates, correos, cuentasFlow } = montarWebhook();

    const resultado = await service.procesarToken('TOK');

    expect(cuentasFlow.buscarPorId).toHaveBeenCalledWith(3);
    expect(updates).toHaveLength(2);
    expect(updates[0].entidad).toBe(Pago);
    expect(estadoDe(updates[0])).toBe('Pago-Pagado');
    expect(updates[0].params).toMatchObject({
      id: 77,
      distintoDe: 'Pago-Pagado',
    });
    expect(updates[0].set.fechaPago).toEqual(new Date('2026-11-10T12:30:00'));
    expect(estadoDe(updates[1])).toBe('Reserva-Programada');
    expect(updates[1].params).toMatchObject({
      id: 5,
      igualA: 'Reserva-Pendiente',
    });
    expect(correos.notificarNuevaReserva).toHaveBeenCalledWith(5);
    expect(resultado).toEqual({
      codigoReserva: 'codigo-reserva',
      estadoPago: 'Pagado',
    });
  });

  it('doble confirmación: el segundo aviso no cambia nada ni repite los correos', async () => {
    const { service, updates, correos } = montarWebhook({ afectados: [0] });

    await service.procesarToken('TOK');

    expect(updates).toHaveLength(1);
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });

  it('rechazado: Pago → Rechazado y reserva Pendiente → Anulado, sin correos', async () => {
    const { service, updates, correos } = montarWebhook({ status: 3 });

    await service.procesarToken('TOK');

    expect(estadoDe(updates[0])).toBe('Pago-Rechazado');
    expect(updates[0].params).toMatchObject({ igualA: 'Pago-Pendiente' });
    expect(estadoDe(updates[1])).toBe('Reserva-Anulado');
    expect(updates[1].params).toMatchObject({ igualA: 'Reserva-Pendiente' });
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });

  it('anulado en Flow (status 4) se trata como rechazo', async () => {
    const { service, updates } = montarWebhook({ status: 4 });
    await service.procesarToken('TOK');
    expect(estadoDe(updates[0])).toBe('Pago-Rechazado');
  });

  it('un rechazo que llega después de otro no toca la reserva', async () => {
    const { service, updates } = montarWebhook({ status: 3, afectados: [0] });
    await service.procesarToken('TOK');
    expect(updates).toHaveLength(1);
  });

  it('pendiente en Flow (status 1) no cambia nada', async () => {
    const { service, updates } = montarWebhook({ status: 1 });
    await service.procesarToken('TOK');
    expect(updates).toHaveLength(0);
  });

  it('pago tardío con la hora libre: reactiva la reserva anulada y envía los correos', async () => {
    const { service, updates, correos, conteo } = montarWebhook({
      afectados: [1, 0, 1],
      estadoReserva: 'Anulado',
      ocupada: false,
    });

    await service.procesarToken('TOK');

    expect(conteo.andWhere).toHaveBeenCalledWith('reserva.Id <> :excluir', {
      excluir: 5,
    });
    expect(updates).toHaveLength(3);
    expect(estadoDe(updates[2])).toBe('Reserva-Programada');
    expect(updates[2].params).toMatchObject({ igualA: 'Reserva-Anulado' });
    expect(correos.notificarNuevaReserva).toHaveBeenCalledWith(5);
  });

  it('pago tardío con la hora tomada: el pago queda Pagado, la reserva Anulado y no hay correos', async () => {
    const { service, updates, correos } = montarWebhook({
      afectados: [1, 0],
      estadoReserva: 'Anulado',
      ocupada: true,
    });

    await service.procesarToken('TOK');

    expect(updates).toHaveLength(2);
    expect(estadoDe(updates[0])).toBe('Pago-Pagado');
    expect(correos.notificarNuevaReserva).not.toHaveBeenCalled();
  });

  it('un token desconocido responde 404', async () => {
    const { service } = montarWebhook({ pago: null });
    await expect(service.procesarToken('OTRO')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un monto distinto al guardado no cambia nada', async () => {
    const { service, updates } = montarWebhook({ amount: 1 });
    await service.procesarToken('TOK');
    expect(updates).toHaveLength(0);
  });

  it('una orden distinta a la guardada no cambia nada', async () => {
    const { service, updates } = montarWebhook({ commerceOrder: 'R-1' });
    await service.procesarToken('TOK');
    expect(updates).toHaveLength(0);
  });

  it('sin la cuenta que firmó el cobro no consulta a Flow', async () => {
    const { service, flow, updates } = montarWebhook({ cuenta: null });
    await service.procesarToken('TOK');
    expect(flow.obtenerEstado).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe('AbonosService.anularVencidos y estadoPagoDeReserva', () => {
  function montarAnulacion(
    opciones: {
      vencidos?: unknown[];
      afectados?: number[];
      reserva?: unknown;
      pago?: unknown;
    } = {},
  ) {
    const afectados = [...(opciones.afectados ?? [1, 1])];
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
    };
    const pagoRepo = {
      find: jest.fn().mockResolvedValue(opciones.vencidos ?? []),
      findOne: jest.fn().mockResolvedValue(
        'pago' in opciones
          ? opciones.pago
          : {
              id: 77,
              monto: '4500.00',
              estado: { nombre: 'Pendiente' },
              fechaExpiracion: new Date('2026-11-10T15:15:00Z'),
            },
      ),
      manager: {
        transaction: jest.fn((fn: (m: typeof manager) => unknown) =>
          fn(manager),
        ),
      },
    };
    const reservaRepo = {
      findOne: jest.fn(({ relations }: { relations: { estado?: boolean } }) =>
        Promise.resolve(
          relations.estado
            ? { id: 5, estado: { nombre: 'Pendiente' } }
            : 'reserva' in opciones
              ? opciones.reserva
              : { id: 5, sucursal: { id: 10 } },
        ),
      ),
    };
    const estadoRepo = {
      findOne: jest.fn(
        ({ where }: { where: { tipo: string; nombre: string } }) =>
          Promise.resolve({ id: `${where.tipo}-${where.nombre}`, ...where }),
      ),
    };
    const service = new AbonosService(
      {} as never,
      pagoRepo as never,
      reservaRepo as never,
      estadoRepo as never,
      {} as never,
      { disponible: true } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, pagoRepo, estadoRepo, updates };
  }

  const vencido = (id: number, reservaId: number) => ({
    id,
    reserva: { id: reservaId },
  });

  it('busca solo pagos Pendiente vencidos de reservas Pendiente de esa sucursal', async () => {
    const { service, pagoRepo, estadoRepo } = montarAnulacion();

    await expect(service.anularVencidos(10)).resolves.toBe(0);

    const { where } = (pagoRepo.find.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where).toMatchObject({
      estado: { tipo: 'Pago', nombre: 'Pendiente' },
      reserva: {
        sucursal: { id: 10 },
        estado: { tipo: 'Reserva', nombre: 'Pendiente' },
      },
    });
    expect(where.fechaExpiracion).toMatchObject({ _type: 'lessThan' });
    // Sin vencidos no consulta estados: es el camino de cada request público.
    expect(estadoRepo.findOne).not.toHaveBeenCalled();
  });

  it('pasa el pago a Rechazado y la reserva a Anulado', async () => {
    const { service, updates } = montarAnulacion({
      vencidos: [vencido(77, 5)],
    });

    await expect(service.anularVencidos(10)).resolves.toBe(1);

    expect(updates.map((u) => (u.set.estado as { id: string }).id)).toEqual([
      'Pago-Rechazado',
      'Reserva-Anulado',
    ]);
    expect(updates[0].params).toMatchObject({
      id: 77,
      igualA: 'Pago-Pendiente',
    });
    expect(updates[1].params).toMatchObject({
      id: 5,
      igualA: 'Reserva-Pendiente',
    });
  });

  it('si la confirmación de Flow ganó la carrera, no anula la reserva', async () => {
    const { service, updates } = montarAnulacion({
      vencidos: [vencido(77, 5), vencido(78, 6)],
      afectados: [0, 1, 1],
    });

    await expect(service.anularVencidos(10)).resolves.toBe(1);
    expect(updates).toHaveLength(3); // 77: solo el intento sobre el pago; 78: pago y reserva.
  });

  it('estadoPagoDeReserva anula vencidos y devuelve el estado de la reserva y del pago', async () => {
    const { service, pagoRepo } = montarAnulacion();

    await expect(service.estadoPagoDeReserva('codigo')).resolves.toEqual({
      estadoReserva: 'Pendiente',
      estadoPago: 'Pendiente',
      monto: 4500,
      expiraEn: new Date('2026-11-10T15:15:00Z'),
    });
    expect(pagoRepo.find).toHaveBeenCalled();
  });

  it('estadoPagoDeReserva responde 404 si la reserva no existe', async () => {
    const { service } = montarAnulacion({ reserva: null });
    await expect(service.estadoPagoDeReserva('codigo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('estadoPagoDeReserva responde 404 si la reserva no tiene pago Flow', async () => {
    const { service } = montarAnulacion({ pago: null });
    await expect(service.estadoPagoDeReserva('codigo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
