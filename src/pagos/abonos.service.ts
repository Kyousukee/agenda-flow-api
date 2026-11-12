import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';
import { Suscripcion } from '../suscripciones/entities/suscripcion.entity';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { PAGOS_ONLINE_POR_PLAN } from '../suscripciones/planes';
import { CifradoCredenciales } from '../flow/cifrado';
import { CuentasFlowService } from '../flow/cuentas-flow.service';
import { CuentaFlow } from '../flow/entities/cuenta-flow.entity';
import { ESTADO_FLOW, FlowClient, montoNetoDeFlow } from '../flow/flow.client';
import { cambiarEstado, fechaDeFlow } from '../flow/cambiar-estado';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { ESTADOS_QUE_LIBERAN, horaOcupada } from '../reservas/disponibilidad';
import {
  MINUTOS_RETENCION_PAGO,
  calcularAbono,
  esTipoAnticipo,
} from './abonos';
import type { TipoAnticipo } from './abonos';

/** Lo que la página pública sabe del cobro al reservar. */
export interface PagoOnlinePublico {
  activo: boolean;
  obligatorio: boolean;
  tipo: TipoAnticipo | null;
  /** CLP fijo (Monto) o porcentaje (Porcentaje). null en Completo o si no está activo. */
  monto: number | null;
}

/** Cobro decidido para una reserva: cuánto y con qué cuenta Flow. */
export interface CobroAbono {
  monto: number;
  cuenta: CuentaFlow;
}

/** Lo que recibe el front para ir a pagar. */
export interface PagoIniciado {
  monto: number;
  urlPago: string;
  expiraEn: Date;
}

const PAGO_ONLINE_INACTIVO: PagoOnlinePublico = {
  activo: false,
  obligatorio: false,
  tipo: null,
  monto: null,
};

export const METODO_PAGO_FLOW = 'Flow';

/** Lo que la página de resultado del front consulta (GET /reservar/reservas/:codigo/pago). */
export interface EstadoPagoReserva {
  estadoReserva: string | null;
  estadoPago: string | null;
  monto: number;
  expiraEn: Date | null;
}

/** Resultado de procesar un token de Flow, para el webhook y la redirección del retorno. */
export interface ResultadoAbono {
  codigoReserva: string;
  /** Pendiente, Pagado o Rechazado. */
  estadoPago: string | null;
}

@Injectable()
export class AbonosService {
  private readonly logger = new Logger(AbonosService.name);
  private readonly estados = new Map<string, Estado>();

  constructor(
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configuracionRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Pago)
    private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    private readonly suscripcionesService: SuscripcionesService,
    private readonly cifrado: CifradoCredenciales,
    private readonly cuentasFlow: CuentasFlowService,
    private readonly flow: FlowClient,
    private readonly reservaCorreos: ReservaCorreosService,
  ) {}

  /**
   * El cobro al reservar está activo si la empresa lo configuró, su plan incluye
   * pagos online y la API puede descifrar credenciales (FLOW_CREDENCIALES_KEY).
   * La cuenta Flow de cada sucursal se resuelve recién al reservar.
   */
  async resolverPagoOnline(
    empresaId: number,
    suscripcion?: Suscripcion,
  ): Promise<{
    publico: PagoOnlinePublico;
    config: ConfiguracionEmpresa | null;
  }> {
    const config = await this.configuracionRepo.findOne({
      where: { empresa: { id: empresaId } },
    });
    if (
      !config?.permitePagoAnticipado ||
      !esTipoAnticipo(config.tipoAnticipo) ||
      !this.cifrado.disponible
    ) {
      return { publico: PAGO_ONLINE_INACTIVO, config: null };
    }
    const { plan } =
      suscripcion ??
      (await this.suscripcionesService.obtenerVigente(empresaId));
    if (!PAGOS_ONLINE_POR_PLAN[plan]) {
      return { publico: PAGO_ONLINE_INACTIVO, config: null };
    }

    const tipo = config.tipoAnticipo;
    return {
      publico: {
        activo: true,
        obligatorio: config.pagoObligatorio,
        tipo,
        monto: tipo === 'Completo' ? null : Number(config.montoAnticipo),
      },
      config,
    };
  }

  /**
   * Decide si esta reserva se cobra. null = se reserva sin pago, como antes de SPEC 06.
   * Si el pago es opcional, solo se cobra con `pagarAhora = true`.
   */
  async evaluarCobro(datos: {
    empresaId: number;
    sucursalId: number;
    precio: number | string;
    pagarAhora?: boolean;
  }): Promise<CobroAbono | null> {
    const { config } = await this.resolverPagoOnline(datos.empresaId);
    if (!config) {
      return null;
    }
    if (!config.pagoObligatorio && datos.pagarAhora !== true) {
      return null;
    }
    const monto = calcularAbono(datos.precio, config);
    if (monto === null) {
      return null;
    }
    const cuenta = await this.cuentasFlow.resolver(datos.sucursalId);
    if (!cuenta) {
      this.logger.warn(
        `La sucursal ${datos.sucursalId} exige pago pero no tiene cuenta Flow (propia ni de la empresa): la reserva se crea sin pago`,
      );
      return null;
    }
    return { monto, cuenta };
  }

  /** Dentro de la transacción de la reserva: Pago Pendiente que retiene la hora 15 minutos. */
  async registrarPendiente(
    manager: EntityManager,
    reservaId: number,
    cobro: CobroAbono,
  ): Promise<Pago> {
    const pendiente = await manager.findOne(Estado, {
      where: { tipo: 'Pago', nombre: 'Pendiente' },
    });
    const ahora = new Date();
    return manager.save(
      manager.create(Pago, {
        reserva: { id: reservaId },
        monto: cobro.monto,
        metodoPago: METODO_PAGO_FLOW,
        fechaPago: ahora,
        fechaExpiracion: new Date(
          ahora.getTime() + MINUTOS_RETENCION_PAGO * 60_000,
        ),
        cuentaFlowId: cobro.cuenta.id,
        estado: pendiente ?? undefined,
      }),
    );
  }

  /**
   * Después del commit: crea el cobro en Flow y guarda token y orden.
   * Si Flow falla (credenciales malas, Flow caído, clave de cifrado cambiada), la reserva
   * pasa a Programada y el Pago a Rechazado, y devuelve null: no se pierde la reserva.
   */
  async iniciar(datos: {
    pago: Pago;
    reservaId: number;
    cobro: CobroAbono;
    email: string;
    subject: string;
  }): Promise<PagoIniciado | null> {
    const { pago, reservaId, cobro } = datos;
    try {
      const creado = await this.flow.crearPago(
        this.cuentasFlow.credenciales(cobro.cuenta),
        {
          commerceOrder: `R-${pago.id}`,
          subject: datos.subject,
          amount: cobro.monto,
          email: datos.email,
          urlConfirmation: this.flow.urlPublica('flow/abono/confirmacion'),
          urlReturn: this.flow.urlPublica('flow/abono/retorno'),
          timeout: MINUTOS_RETENCION_PAGO * 60,
        },
      );
      await this.pagoRepo.update(pago.id, {
        flowToken: creado.token,
        flowOrder: String(creado.flowOrder),
      });
      return {
        monto: cobro.monto,
        urlPago: creado.urlPago,
        expiraEn: pago.fechaExpiracion!,
      };
    } catch (error) {
      this.logger.error(
        `No se pudo crear el cobro Flow del pago ${pago.id} (reserva ${reservaId}): ${
          error instanceof Error ? error.message : String(error)
        }. La reserva queda sin pago.`,
      );
      await this.revertirSinPago(pago.id, reservaId);
      return null;
    }
  }

  /**
   * Webhook de confirmación y retorno de Flow. Nunca confía en el body: busca el pago
   * por token, consulta getStatus con la cuenta que firmó el cobro y compara monto y orden.
   * Es idempotente: confirmación y retorno pueden llegar a la vez o repetirse.
   */
  async procesarToken(token: string): Promise<ResultadoAbono> {
    const pago = await this.pagoRepo.findOne({
      where: { flowToken: token },
      relations: { estado: true, reserva: { empleado: true } },
    });
    if (!pago?.reserva) {
      throw new NotFoundException('Pago no encontrado');
    }

    const cuenta = pago.cuentaFlowId
      ? await this.cuentasFlow.buscarPorId(pago.cuentaFlowId)
      : null;
    if (!cuenta) {
      this.logger.error(
        `El pago ${pago.id} tiene token Flow pero no su cuenta (${pago.cuentaFlowId}): no se puede verificar`,
      );
      return this.resultado(pago.id, pago.reserva.codigo);
    }

    const estadoFlow = await this.flow.obtenerEstado(
      this.cuentasFlow.credenciales(cuenta),
      token,
    );
    if (
      estadoFlow.commerceOrder !== `R-${pago.id}` ||
      estadoFlow.amount !== Number(pago.monto)
    ) {
      this.logger.error(
        `Flow informó orden ${estadoFlow.commerceOrder} por ${estadoFlow.amount} para el pago ${pago.id} ` +
          `(esperado R-${pago.id} por ${Number(pago.monto)}): no se cambia nada`,
      );
      return this.resultado(pago.id, pago.reserva.codigo);
    }

    if (estadoFlow.status === ESTADO_FLOW.PAGADA) {
      await this.confirmarPagado(
        pago,
        fechaDeFlow(estadoFlow.paymentData?.date),
        montoNetoDeFlow(estadoFlow.paymentData),
      );
    } else if (
      estadoFlow.status === ESTADO_FLOW.RECHAZADA ||
      estadoFlow.status === ESTADO_FLOW.ANULADA
    ) {
      await this.confirmarRechazado(pago);
    }
    // ESTADO_FLOW.PENDIENTE: no cambia nada.

    return this.resultado(pago.id, pago.reserva.codigo);
  }

  /**
   * Pagado: Pago → Pagado y reserva Pendiente → Programada, con los correos de SPEC 02.
   * Pago tardío (reserva ya Anulado): se reactiva solo si la hora sigue libre.
   * SPEC 07: guarda el neto que recibe el local (paymentData.balance), tope de los reembolsos.
   */
  private async confirmarPagado(
    pago: Pago,
    fechaPago: Date,
    montoNeto: number | null,
  ): Promise<void> {
    const reserva = pago.reserva;
    const [pagado, pendiente, programada, anulado] = await Promise.all([
      this.estado('Pago', 'Pagado'),
      this.estado('Reserva', 'Pendiente'),
      this.estado('Reserva', 'Programada'),
      this.estado('Reserva', 'Anulado'),
    ]);

    const notificar = await this.pagoRepo.manager.transaction(async (m) => {
      // El dinero se recibió: el pago queda Pagado aunque la reserva ya se haya anulado.
      const pagoCambiado = await cambiarEstado(m, Pago, pago.id, pagado, {
        distintoDe: pagado.id,
        extra: montoNeto === null ? { fechaPago } : { fechaPago, montoNeto },
      });
      if (!pagoCambiado) {
        return false; // Otro proceso ya lo confirmó.
      }

      if (
        await cambiarEstado(m, Reserva, reserva.id, programada, {
          igualA: pendiente.id,
        })
      ) {
        return true;
      }

      const actual = await m.findOne(Reserva, {
        where: { id: reserva.id },
        relations: { estado: true },
      });
      if (actual?.estado?.id === anulado.id) {
        const ocupada = reserva.empleado
          ? await horaOcupada(m, {
              empleadoId: reserva.empleado.id,
              fecha: reserva.fecha,
              horaInicio: reserva.horaInicio,
              horaFin: reserva.horaFin,
              excluirReservaId: reserva.id,
            })
          : false;
        if (
          !ocupada &&
          (await cambiarEstado(m, Reserva, reserva.id, programada, {
            igualA: anulado.id,
          }))
        ) {
          this.logger.warn(
            `Pago ${pago.id} recibido sobre reserva anulada: la hora seguía libre y la reserva ${reserva.id} se reactivó`,
          );
          return true;
        }
      }

      if (
        !actual?.estado ||
        ESTADOS_QUE_LIBERAN.includes(actual.estado.nombre)
      ) {
        this.logger.error(
          `Pago ${pago.id} recibido sobre reserva anulada: requiere reembolso manual`,
        );
      }
      return false;
    });

    if (notificar) {
      void this.reservaCorreos.notificarNuevaReserva(reserva.id);
    }
  }

  /** Rechazado o anulado en Flow: Pago → Rechazado y la reserva Pendiente → Anulado (libera la hora). */
  private async confirmarRechazado(pago: Pago): Promise<void> {
    const [pendientePago, rechazado, pendienteReserva, anulado] =
      await Promise.all([
        this.estado('Pago', 'Pendiente'),
        this.estado('Pago', 'Rechazado'),
        this.estado('Reserva', 'Pendiente'),
        this.estado('Reserva', 'Anulado'),
      ]);

    await this.pagoRepo.manager.transaction(async (m) => {
      const pagoCambiado = await cambiarEstado(m, Pago, pago.id, rechazado, {
        igualA: pendientePago.id,
      });
      if (pagoCambiado) {
        await cambiarEstado(m, Reserva, pago.reserva.id, anulado, {
          igualA: pendienteReserva.id,
        });
      }
    });
  }

  /**
   * SPEC 07: neto que recibió el local por un abono Flow, en pesos enteros. Es el tope
   * de los reembolsos. Si no se guardó al confirmar (pagos anteriores a la migración 006),
   * se consulta payment/getStatus con la cuenta que firmó el cobro y se guarda.
   * Lanza 502 si Flow no responde o no informa `balance`.
   */
  async asegurarMontoNeto(pago: Pago): Promise<number> {
    if (pago.montoNeto !== null && pago.montoNeto !== undefined) {
      return Number(pago.montoNeto);
    }

    const cuenta =
      pago.cuentaFlowId && pago.flowToken
        ? await this.cuentasFlow.buscarPorId(pago.cuentaFlowId)
        : null;
    if (!cuenta || !pago.flowToken) {
      throw new BadGatewayException(
        'No se pudo obtener de Flow el monto neto del pago',
      );
    }

    let neto: number | null;
    try {
      const estadoFlow = await this.flow.obtenerEstado(
        this.cuentasFlow.credenciales(cuenta),
        pago.flowToken,
      );
      neto =
        estadoFlow.commerceOrder === `R-${pago.id}`
          ? montoNetoDeFlow(estadoFlow.paymentData)
          : null;
    } catch (error) {
      // Flow caído, credenciales malas o FLOW_CREDENCIALES_KEY cambiada.
      this.logger.error(
        `No se pudo consultar el neto del pago ${pago.id} en Flow: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      neto = null;
    }

    if (neto === null) {
      throw new BadGatewayException(
        'No se pudo obtener de Flow el monto neto del pago',
      );
    }
    await this.pagoRepo.update(pago.id, { montoNeto: neto });
    pago.montoNeto = neto;
    return neto;
  }

  /**
   * Anulación perezosa (sin cron): las reservas Pendiente de la sucursal cuyo pago Flow
   * sigue Pendiente con la retención vencida pasan a Anulado y liberan la hora; sus pagos
   * quedan Rechazado. Devuelve cuántas anuló. Si después llega el pago, aplica la regla
   * de pago tardío de procesarToken.
   */
  async anularVencidos(sucursalId: number): Promise<number> {
    const vencidos = await this.pagoRepo.find({
      where: {
        estado: { tipo: 'Pago', nombre: 'Pendiente' },
        fechaExpiracion: LessThan(new Date()),
        reserva: {
          sucursal: { id: sucursalId },
          estado: { tipo: 'Reserva', nombre: 'Pendiente' },
        },
      },
      relations: { reserva: true },
    });
    if (vencidos.length === 0) {
      return 0;
    }

    const [pendientePago, rechazado, pendienteReserva, anulado] =
      await Promise.all([
        this.estado('Pago', 'Pendiente'),
        this.estado('Pago', 'Rechazado'),
        this.estado('Reserva', 'Pendiente'),
        this.estado('Reserva', 'Anulado'),
      ]);

    let anuladas = 0;
    for (const pago of vencidos) {
      const anulada = await this.pagoRepo.manager.transaction(async (m) => {
        // Si la confirmación de Flow ganó la carrera, el pago ya no está Pendiente y no se toca.
        if (
          !(await cambiarEstado(m, Pago, pago.id, rechazado, {
            igualA: pendientePago.id,
          }))
        ) {
          return false;
        }
        return cambiarEstado(m, Reserva, pago.reserva.id, anulado, {
          igualA: pendienteReserva.id,
        });
      });
      if (anulada) {
        anuladas++;
      }
    }
    if (anuladas > 0) {
      this.logger.log(
        `Sucursal ${sucursalId}: ${anuladas} reserva(s) anulada(s) por pago no confirmado en ${MINUTOS_RETENCION_PAGO} minutos`,
      );
    }
    return anuladas;
  }

  /** GET /reservar/reservas/:codigo/pago. 404 si la reserva no existe o no tiene pago Flow. */
  async estadoPagoDeReserva(codigo: string): Promise<EstadoPagoReserva> {
    const reserva = await this.reservaRepo.findOne({
      where: { codigo },
      relations: { sucursal: true },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    await this.anularVencidos(reserva.sucursal.id);

    const [actual, pago] = await Promise.all([
      this.reservaRepo.findOne({
        where: { id: reserva.id },
        relations: { estado: true },
      }),
      this.pagoRepo.findOne({
        where: { reserva: { id: reserva.id }, metodoPago: METODO_PAGO_FLOW },
        relations: { estado: true },
        order: { id: 'DESC' },
      }),
    ]);
    if (!pago) {
      throw new NotFoundException('La reserva no tiene un pago online');
    }
    return {
      estadoReserva: actual?.estado?.nombre ?? null,
      estadoPago: pago.estado?.nombre ?? null,
      monto: Number(pago.monto),
      expiraEn: pago.fechaExpiracion ?? null,
    };
  }

  /** Para redirigir el retorno aunque Flow no haya respondido. 404 si el token no existe. */
  async codigoReservaPorToken(token: string): Promise<string> {
    const pago = await this.pagoRepo.findOne({
      where: { flowToken: token },
      relations: { reserva: true },
    });
    if (!pago?.reserva) {
      throw new NotFoundException('Pago no encontrado');
    }
    return pago.reserva.codigo;
  }

  private async resultado(
    pagoId: number,
    codigoReserva: string,
  ): Promise<ResultadoAbono> {
    const actual = await this.pagoRepo.findOne({
      where: { id: pagoId },
      relations: { estado: true },
    });
    return { codigoReserva, estadoPago: actual?.estado?.nombre ?? null };
  }

  /** Los estados del catálogo no cambian en ejecución: se cachean por tipo y nombre. */
  private async estado(tipo: string, nombre: string): Promise<Estado> {
    const clave = `${tipo}:${nombre}`;
    const enCache = this.estados.get(clave);
    if (enCache) {
      return enCache;
    }
    const estado = await this.estadoRepo.findOne({ where: { tipo, nombre } });
    if (!estado) {
      throw new InternalServerErrorException(
        `No existe el estado '${nombre}' de tipo '${tipo}'`,
      );
    }
    this.estados.set(clave, estado);
    return estado;
  }

  private async revertirSinPago(
    pagoId: number,
    reservaId: number,
  ): Promise<void> {
    const [programada, rechazado] = await Promise.all([
      this.estadoRepo.findOne({
        where: { tipo: 'Reserva', nombre: 'Programada' },
      }),
      this.estadoRepo.findOne({ where: { tipo: 'Pago', nombre: 'Rechazado' } }),
    ]);
    if (programada) {
      await this.reservaRepo.update(reservaId, { estado: programada });
    }
    if (rechazado) {
      await this.pagoRepo.update(pagoId, { estado: rechazado });
    }
  }
}
