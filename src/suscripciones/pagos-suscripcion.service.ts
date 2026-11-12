import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PagoSuscripcion } from './entities/pago-suscripcion.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { SuscripcionesService } from './suscripciones.service';
import { DIAS_POR_PAGO, PRECIO_PRO_CLP } from './planes';
import { ESTADO_FLOW, FlowClient } from '../flow/flow.client';
import { cambiarEstado, fechaDeFlow } from '../flow/cambiar-estado';

export interface PagoMensualidadIniciado {
  urlPago: string;
  pagoId: number;
}

export interface PagoMensualidad {
  id: number;
  monto: number;
  dias: number;
  estado: { nombre: string; color: string | null } | null;
  fechaCreacion: Date;
  fechaPago: Date | null;
  finNuevo: Date | null;
}

/** Para la redirección del retorno: /suscripcion/pago?estado=... */
export type ResultadoMensualidad = 'pagado' | 'rechazado' | 'pendiente';

const SUBJECT = `AgendaFlow Pro - ${DIAS_POR_PAGO} días`;

/**
 * SPEC 06: mensualidad Pro cobrada con Flow a la cuenta de AgendaFlow (FLOW_API_KEY).
 * Al confirmarse el pago se extiende Pro DIAS_POR_PAGO días.
 */
@Injectable()
export class PagosSuscripcionService {
  private readonly logger = new Logger(PagosSuscripcionService.name);
  private readonly estados = new Map<string, Estado>();

  constructor(
    @InjectRepository(PagoSuscripcion)
    private readonly pagoRepo: Repository<PagoSuscripcion>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    private readonly suscripcionesService: SuscripcionesService,
    private readonly flow: FlowClient,
  ) {}

  async iniciar(
    empresaId: number,
    email: string,
  ): Promise<PagoMensualidadIniciado> {
    const credenciales = this.flow.credencialesAgendaFlow;
    if (!credenciales) {
      throw new ServiceUnavailableException(
        'El pago de la suscripción no está disponible',
      );
    }

    const vigente = await this.suscripcionesService.obtenerVigente(empresaId);
    if (vigente.plan === 'Pro' && vigente.fechaFin === null) {
      throw new ConflictException('Tu plan Pro no tiene vencimiento');
    }

    const pago = await this.pagoRepo.save(
      this.pagoRepo.create({
        empresaId,
        monto: PRECIO_PRO_CLP,
        dias: DIAS_POR_PAGO,
        estado: await this.estado('Pendiente'),
      }),
    );

    try {
      const creado = await this.flow.crearPago(credenciales, {
        commerceOrder: `S-${pago.id}`,
        subject: SUBJECT,
        amount: PRECIO_PRO_CLP,
        email,
        urlConfirmation: this.flow.urlPublica('flow/suscripcion/confirmacion'),
        urlReturn: this.flow.urlPublica('flow/suscripcion/retorno'),
      });
      await this.pagoRepo.update(pago.id, {
        flowToken: creado.token,
        flowOrder: String(creado.flowOrder),
      });
      return { urlPago: creado.urlPago, pagoId: pago.id };
    } catch (error) {
      this.logger.error(
        `No se pudo crear el cobro Flow de la mensualidad ${pago.id} (empresa ${empresaId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.pagoRepo.update(pago.id, {
        estado: await this.estado('Rechazado'),
      });
      throw new BadGatewayException(
        'No pudimos conectar con Flow. Inténtalo de nuevo en unos minutos.',
      );
    }
  }

  async listar(empresaId: number): Promise<PagoMensualidad[]> {
    const pagos = await this.pagoRepo.find({
      where: { empresaId },
      relations: { estado: true },
      order: { id: 'DESC' },
    });
    return pagos.map((p) => ({
      id: p.id,
      monto: Number(p.monto),
      dias: p.dias,
      estado: p.estado
        ? { nombre: p.estado.nombre, color: p.estado.color ?? null }
        : null,
      fechaCreacion: p.fechaCreacion,
      fechaPago: p.fechaPago,
      finNuevo: p.finNuevo,
    }));
  }

  /**
   * Webhook de confirmación y retorno. No confía en el body: consulta getStatus con la
   * cuenta de AgendaFlow y compara monto y orden. Una doble confirmación extiende una vez.
   */
  async procesarToken(token: string): Promise<ResultadoMensualidad> {
    const pago = await this.pagoRepo.findOne({ where: { flowToken: token } });
    if (!pago) {
      throw new NotFoundException('Pago no encontrado');
    }
    const credenciales = this.flow.credencialesAgendaFlow;
    if (!credenciales) {
      this.logger.error(
        `Llegó la confirmación de la mensualidad ${pago.id} pero FLOW_API_KEY no está configurada`,
      );
      return this.resultado(pago.id);
    }

    const estadoFlow = await this.flow.obtenerEstado(credenciales, token);
    if (
      estadoFlow.commerceOrder !== `S-${pago.id}` ||
      estadoFlow.amount !== Number(pago.monto)
    ) {
      this.logger.error(
        `Flow informó orden ${estadoFlow.commerceOrder} por ${estadoFlow.amount} para la mensualidad ${pago.id} ` +
          `(esperado S-${pago.id} por ${Number(pago.monto)}): no se cambia nada`,
      );
      return this.resultado(pago.id);
    }

    if (estadoFlow.status === ESTADO_FLOW.PAGADA) {
      await this.confirmarPagado(
        pago,
        fechaDeFlow(estadoFlow.paymentData?.date),
      );
    } else if (
      estadoFlow.status === ESTADO_FLOW.RECHAZADA ||
      estadoFlow.status === ESTADO_FLOW.ANULADA
    ) {
      await this.pagoRepo.manager.transaction(async (m) =>
        cambiarEstado(
          m,
          PagoSuscripcion,
          pago.id,
          await this.estado('Rechazado'),
          {
            igualA: (await this.estado('Pendiente')).id,
          },
        ),
      );
    }
    return this.resultado(pago.id);
  }

  private async confirmarPagado(
    pago: PagoSuscripcion,
    fechaPago: Date,
  ): Promise<void> {
    const pagado = await this.estado('Pagado');
    await this.pagoRepo.manager.transaction(async (m) => {
      const cambiado = await cambiarEstado(
        m,
        PagoSuscripcion,
        pago.id,
        pagado,
        {
          distintoDe: pagado.id,
          extra: { fechaPago },
        },
      );
      if (!cambiado) {
        return; // Otro proceso ya lo confirmó y extendió.
      }
      const { finAnterior, finNuevo } =
        await this.suscripcionesService.extenderPro(
          pago.empresaId,
          pago.dias,
          m,
        );
      await m.update(PagoSuscripcion, pago.id, { finAnterior, finNuevo });
      if (finNuevo) {
        this.logger.log(
          `Empresa ${pago.empresaId}: Pro extendido ${pago.dias} días hasta ${finNuevo.toISOString()} (pago ${pago.id})`,
        );
      } else {
        this.logger.warn(
          `Empresa ${pago.empresaId}: pagó la mensualidad ${pago.id} pero ya tiene Pro sin vencimiento`,
        );
      }
    });
  }

  private async resultado(pagoId: number): Promise<ResultadoMensualidad> {
    const actual = await this.pagoRepo.findOne({
      where: { id: pagoId },
      relations: { estado: true },
    });
    switch (actual?.estado?.nombre) {
      case 'Pagado':
        return 'pagado';
      case 'Rechazado':
        return 'rechazado';
      default:
        return 'pendiente';
    }
  }

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
