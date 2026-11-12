import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Pago } from './entities/pago.entity';
import { Reembolso } from './entities/reembolso.entity';
import type { OrigenReembolso } from './entities/reembolso.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { CuentasFlowService } from '../flow/cuentas-flow.service';
import {
  ESTADO_REEMBOLSO_FLOW,
  FlowClient,
  ReembolsoFlow,
} from '../flow/flow.client';
import { cambiarEstado } from '../flow/cambiar-estado';
import { AbonosService } from './abonos.service';
import { ReservaCorreosService } from '../correos/reserva-correos.service';

/** Ruta del webhook de Flow para los reembolsos (relativa a API_PUBLIC_URL). */
export const RUTA_CONFIRMACION_REEMBOLSO = 'flow/reembolso/confirmacion';

const LARGO_MAXIMO_ERROR = 500;

export interface SolicitudReembolso {
  pagoId: number;
  /** Pesos enteros. Si se omite, se reembolsa todo el reembolsable. */
  monto?: number;
  origen: OrigenReembolso;
  usuarioId?: number | null;
}

export interface ReembolsoSolicitado {
  id: number;
  monto: number;
  /** Pendiente o Reembolsado (Flow puede resolverlo al instante). */
  estado: string;
}

export interface ReembolsoHistorial {
  id: number;
  monto: number;
  origen: OrigenReembolso;
  estado: { id: number; nombre: string; color?: string } | null;
  comisionFlow: number | null;
  error: string | null;
  fechaCreacion: Date;
  fechaResolucion: Date | null;
}

/** Estados de Flow que cierran el reembolso, mapeados al estado de tipo 'Pago'. */
function estadoFinal(status: string): 'Reembolsado' | 'Rechazado' | null {
  switch (status) {
    case ESTADO_REEMBOLSO_FLOW.REEMBOLSADO:
      return 'Reembolsado';
    case ESTADO_REEMBOLSO_FLOW.RECHAZADO:
    case ESTADO_REEMBOLSO_FLOW.CANCELADO:
      return 'Rechazado';
    default:
      return null; // created, accepted: sigue Pendiente.
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * SPEC 07: reembolsos de abonos cobrados con Flow. El tope es el neto que recibió el
 * local (Pago.MontoNeto). Cada reembolso se firma con la cuenta que firmó el cobro,
 * aunque esté dada de baja. No depende del plan vigente.
 */
@Injectable()
export class ReembolsosService {
  private readonly logger = new Logger(ReembolsosService.name);
  private readonly estados = new Map<string, Estado>();

  constructor(
    @InjectRepository(Pago)
    private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Reembolso)
    private readonly reembolsoRepo: Repository<Reembolso>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    private readonly abonos: AbonosService,
    private readonly cuentasFlow: CuentasFlowService,
    private readonly flow: FlowClient,
    private readonly correos: ReservaCorreosService,
  ) {}

  /**
   * 1. Bloquea el pago, valida y reserva el monto con un Reembolso Pendiente.
   * 2. Después del commit pide el reembolso a Flow.
   * 3. Si Flow falla o lo rechaza: Reembolso Rechazado y 502 (quien llama no cancela nada).
   */
  async solicitar(datos: SolicitudReembolso): Promise<ReembolsoSolicitado> {
    const pago = await this.pagoRepo.findOne({
      where: { id: datos.pagoId },
      relations: { estado: true, reserva: { cliente: true } },
    });
    if (!pago) {
      throw new NotFoundException('Pago no encontrado');
    }
    this.validarReembolsable(pago);
    const receptor = pago.reserva?.cliente?.email?.trim();
    if (!receptor) {
      throw new BadRequestException(
        'El pago no tiene el email del cliente para enviarle el reembolso',
      );
    }

    // Puede consultar a Flow (pagos anteriores a la migración 006): antes de bloquear.
    const neto = await this.abonos.asegurarMontoNeto(pago);

    const [pendiente, pagado] = await Promise.all([
      this.estado('Pendiente'),
      this.estado('Pagado'),
    ]);
    const reembolso = await this.pagoRepo.manager.transaction(async (m) => {
      // Dos solicitudes simultáneas sobre el mismo pago se serializan aquí.
      const [bloqueado] = await m.query<{ EstadoId: number | null }[]>(
        'SELECT EstadoId FROM dbo.Pago WITH (UPDLOCK, HOLDLOCK) WHERE Id = @0',
        [pago.id],
      );
      if (!bloqueado || bloqueado.EstadoId !== pagado.id) {
        throw new BadRequestException(
          'Solo se pueden reembolsar pagos en estado Pagado',
        );
      }

      const reembolsable = neto - (await this.comprometido(m, pago.id));
      if (reembolsable <= 0) {
        throw new BadRequestException('El pago no tiene saldo por reembolsar');
      }
      const monto = datos.monto ?? reembolsable;
      if (!Number.isInteger(monto) || monto < 1 || monto > reembolsable) {
        throw new BadRequestException(
          `El monto a reembolsar debe ser un entero entre 1 y ${reembolsable}`,
        );
      }

      return m.save(
        m.create(Reembolso, {
          pagoId: pago.id,
          monto,
          origen: datos.origen,
          usuarioId: datos.usuarioId ?? null,
          estado: pendiente,
          flowToken: null,
          flowRefundOrder: null,
          comisionFlow: null,
          error: null,
          fechaResolucion: null,
        }),
      );
    });

    let respuesta: ReembolsoFlow;
    try {
      const cuenta = await this.cuentasFlow.buscarPorId(pago.cuentaFlowId!);
      if (!cuenta) {
        throw new Error(`No existe la cuenta Flow ${pago.cuentaFlowId}`);
      }
      respuesta = await this.flow.crearReembolso(
        this.cuentasFlow.credenciales(cuenta),
        {
          refundCommerceOrder: `RF-${reembolso.id}`,
          receiverEmail: receptor,
          amount: Number(reembolso.monto),
          urlCallBack: this.flow.urlPublica(RUTA_CONFIRMACION_REEMBOLSO),
          commerceTrxId: `R-${pago.id}`,
        },
      );
    } catch (error) {
      const mensaje = mensajeDe(error);
      this.logger.error(
        `Flow no aceptó el reembolso ${reembolso.id} del pago ${pago.id}: ${mensaje}`,
      );
      await this.marcarRechazado(reembolso.id, mensaje);
      throw new BadGatewayException(`Flow no aceptó el reembolso: ${mensaje}`);
    }

    await this.reembolsoRepo.update(reembolso.id, {
      flowToken: respuesta.token,
      flowRefundOrder:
        Number.isFinite(respuesta.flowRefundOrder) &&
        respuesta.flowRefundOrder > 0
          ? String(respuesta.flowRefundOrder)
          : null,
      comisionFlow: respuesta.fee,
    });

    if (estadoFinal(respuesta.status) === 'Rechazado') {
      const mensaje = `Flow respondió ${respuesta.status}`;
      await this.marcarRechazado(reembolso.id, mensaje);
      throw new BadGatewayException(`Flow no aceptó el reembolso: ${mensaje}`);
    }

    const estado = await this.aplicar(reembolso, respuesta);
    return { id: reembolso.id, monto: Number(reembolso.monto), estado };
  }

  /**
   * Webhook de Flow (urlCallBack). No confía en el body: busca el reembolso por token y
   * consulta refund/getStatus con la cuenta del pago. Es idempotente.
   * Devuelve el estado del reembolso después de procesar.
   */
  async procesarToken(token: string): Promise<string> {
    const reembolso = await this.reembolsoRepo.findOne({
      where: { flowToken: token },
      relations: { estado: true, pago: true },
    });
    if (!reembolso?.pago) {
      throw new NotFoundException('Reembolso no encontrado');
    }
    return this.consultarYAplicar(reembolso);
  }

  /**
   * Consulta perezosa (sin cron): actualiza los reembolsos Pendiente del pago cuyo
   * callback no llegó. Un fallo de Flow se loguea y deja el reembolso como estaba.
   */
  async refrescarPendientes(pagoId: number): Promise<void> {
    const pendientes = await this.reembolsoRepo.find({
      where: {
        pagoId,
        estado: { tipo: 'Pago', nombre: 'Pendiente' },
      },
      relations: { estado: true, pago: true },
    });
    for (const reembolso of pendientes) {
      if (!reembolso.flowToken) {
        continue; // No llegó a Flow: no hay nada que consultar.
      }
      try {
        await this.consultarYAplicar(reembolso);
      } catch (error) {
        this.logger.warn(
          `No se pudo refrescar el reembolso ${reembolso.id}: ${mensajeDe(error)}`,
        );
      }
    }
  }

  /** Reembolsos del pago, el más reciente primero, con lo que muestra el panel. */
  async historial(pagoId: number): Promise<ReembolsoHistorial[]> {
    const reembolsos = await this.reembolsoRepo.find({
      where: { pagoId },
      relations: { estado: true },
      order: { fechaCreacion: 'DESC', id: 'DESC' },
    });
    return reembolsos.map((r) => ({
      id: r.id,
      monto: Number(r.monto),
      origen: r.origen,
      estado: r.estado
        ? { id: r.estado.id, nombre: r.estado.nombre, color: r.estado.color }
        : null,
      comisionFlow: r.comisionFlow === null ? null : Number(r.comisionFlow),
      error: r.error,
      fechaCreacion: r.fechaCreacion,
      fechaResolucion: r.fechaResolucion,
    }));
  }

  /** Suma de los reembolsos Reembolsado de cada pago (para `montoReembolsado` en GET /pagos). */
  async reembolsadoPorPago(pagoIds: number[]): Promise<Map<number, number>> {
    const totales = new Map<number, number>();
    if (pagoIds.length === 0) {
      return totales;
    }
    const reembolsado = await this.estado('Reembolsado');
    const reembolsos = await this.reembolsoRepo.find({
      where: { pagoId: In(pagoIds), estado: { id: reembolsado.id } },
    });
    for (const r of reembolsos) {
      totales.set(r.pagoId, (totales.get(r.pagoId) ?? 0) + Number(r.monto));
    }
    return totales;
  }

  /** Suma de los reembolsos Pendiente o Reembolsado del pago: el monto ya comprometido. */
  async comprometido(manager: EntityManager, pagoId: number): Promise<number> {
    const [pendiente, reembolsado] = await Promise.all([
      this.estado('Pendiente'),
      this.estado('Reembolsado'),
    ]);
    const reembolsos = await manager.find(Reembolso, {
      where: {
        pagoId,
        estado: { id: In([pendiente.id, reembolsado.id]) },
      },
    });
    return reembolsos.reduce((total, r) => total + Number(r.monto), 0);
  }

  /** Lo que todavía se puede reembolsar del pago, en pesos enteros. */
  async reembolsable(pago: Pago): Promise<number> {
    const neto = await this.abonos.asegurarMontoNeto(pago);
    const disponible =
      neto - (await this.comprometido(this.pagoRepo.manager, pago.id));
    return Math.max(0, disponible);
  }

  private validarReembolsable(pago: Pago): void {
    if (!pago.cuentaFlowId) {
      throw new BadRequestException(
        'Solo los pagos cobrados con Flow se reembolsan desde aquí',
      );
    }
    if (pago.estado?.nombre !== 'Pagado') {
      throw new BadRequestException(
        'Solo se pueden reembolsar pagos en estado Pagado',
      );
    }
  }

  private async consultarYAplicar(reembolso: Reembolso): Promise<string> {
    const cuenta = await this.cuentasFlow.buscarPorId(
      reembolso.pago.cuentaFlowId!,
    );
    if (!cuenta) {
      this.logger.error(
        `El reembolso ${reembolso.id} no tiene la cuenta Flow ${reembolso.pago.cuentaFlowId}: no se puede verificar`,
      );
      return reembolso.estado?.nombre ?? 'Pendiente';
    }

    const estadoFlow = await this.flow.estadoReembolso(
      this.cuentasFlow.credenciales(cuenta),
      reembolso.flowToken!,
    );
    if (
      Number.isFinite(estadoFlow.amount) &&
      estadoFlow.amount !== Number(reembolso.monto)
    ) {
      this.logger.error(
        `Flow informó ${estadoFlow.amount} para el reembolso ${reembolso.id} ` +
          `(esperado ${Number(reembolso.monto)}): no se cambia nada`,
      );
      return reembolso.estado?.nombre ?? 'Pendiente';
    }
    return this.aplicar(reembolso, estadoFlow);
  }

  /**
   * Transición Pendiente → Reembolsado | Rechazado con UPDATE condicional. Si otro proceso
   * ya la hizo, no repite nada. Al quedar Reembolsado, el Pago pasa a Reembolsado cuando
   * los reembolsos cubren todo el neto.
   */
  private async aplicar(
    reembolso: Pick<Reembolso, 'id' | 'pagoId' | 'monto'>,
    estadoFlow: ReembolsoFlow,
  ): Promise<string> {
    const final = estadoFinal(estadoFlow.status);
    if (!final) {
      return 'Pendiente';
    }
    const [pendiente, nuevo] = await Promise.all([
      this.estado('Pendiente'),
      this.estado(final),
    ]);

    const cambio = await this.pagoRepo.manager.transaction(async (m) => {
      const cambiado = await cambiarEstado(m, Reembolso, reembolso.id, nuevo, {
        igualA: pendiente.id,
        extra: {
          fechaResolucion: new Date(),
          ...(estadoFlow.fee !== null && { comisionFlow: estadoFlow.fee }),
          ...(final === 'Rechazado' && {
            error: `Flow informó ${estadoFlow.status}`,
          }),
        },
      });
      if (cambiado && final === 'Reembolsado') {
        await this.cerrarPagoSiCompleto(m, reembolso.pagoId);
      }
      return cambiado;
    });

    if (cambio && final === 'Rechazado') {
      // Flow lo aceptó y después lo rechazó: la reserva ya pudo cancelarse. El UPDATE
      // condicional garantiza que el aviso al local sale una sola vez.
      this.logger.error(
        `Flow rechazó el reembolso ${reembolso.id} del pago ${reembolso.pagoId} después de aceptarlo: hay que reintentarlo desde el panel`,
      );
      const pago = await this.pagoRepo.findOne({
        where: { id: reembolso.pagoId },
        relations: { reserva: true },
      });
      if (pago?.reserva) {
        void this.correos.notificarReembolsoRechazado(
          pago.reserva.id,
          Number(reembolso.monto),
          `Flow informó ${estadoFlow.status}`,
        );
      }
    }

    const actual = await this.reembolsoRepo.findOne({
      where: { id: reembolso.id },
      relations: { estado: true },
    });
    return actual?.estado?.nombre ?? final;
  }

  /** Pago → Reembolsado cuando la suma de reembolsos Reembolsado llega a MontoNeto. */
  private async cerrarPagoSiCompleto(
    m: EntityManager,
    pagoId: number,
  ): Promise<void> {
    // El reembolso y el pago usan el mismo catálogo de estados de tipo 'Pago'.
    const [reembolsado, pagado] = await Promise.all([
      this.estado('Reembolsado'),
      this.estado('Pagado'),
    ]);
    const pago = await m.findOne(Pago, { where: { id: pagoId } });
    if (pago?.montoNeto === null || pago?.montoNeto === undefined) {
      return;
    }
    const reembolsos = await m.find(Reembolso, {
      where: { pagoId, estado: { id: reembolsado.id } },
    });
    const total = reembolsos.reduce((suma, r) => suma + Number(r.monto), 0);
    if (total >= Number(pago.montoNeto)) {
      await cambiarEstado(m, Pago, pagoId, reembolsado, {
        igualA: pagado.id,
      });
    }
  }

  /** Flow falló o lo rechazó al pedirlo: el reembolso queda Rechazado y libera su monto. */
  private async marcarRechazado(id: number, mensaje: string): Promise<void> {
    const [pendiente, rechazado] = await Promise.all([
      this.estado('Pendiente'),
      this.estado('Rechazado'),
    ]);
    await cambiarEstado(this.pagoRepo.manager, Reembolso, id, rechazado, {
      igualA: pendiente.id,
      extra: {
        error: mensaje.slice(0, LARGO_MAXIMO_ERROR),
        fechaResolucion: new Date(),
      },
    });
  }

  /** Estados de tipo 'Pago' (Pendiente, Pagado, Rechazado, Reembolsado), cacheados. */
  private async estado(nombre: string): Promise<Estado> {
    const enCache = this.estados.get(nombre);
    if (enCache) {
      return enCache;
    }
    const estado = await this.estadoRepo.findOne({
      where: { tipo: 'Pago', nombre },
    });
    if (!estado) {
      throw new InternalServerErrorException(
        `No existe el estado '${nombre}' de tipo 'Pago'`,
      );
    }
    this.estados.set(nombre, estado);
    return estado;
  }
}
