import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';
import { Pago } from '../pagos/entities/pago.entity';
import { ReembolsosService } from '../pagos/reembolsos.service';
import { cambiarEstado } from '../flow/cambiar-estado';
import { hashToken } from '../auth/token-cuenta';
import { limiteCancelacion } from '../reservas/cancelacion';
import { ReservaCorreosService } from '../correos/reserva-correos.service';

export type MotivoNoCancelable =
  'FUERA_DE_PLAZO' | 'YA_CANCELADA' | 'NO_CANCELABLE';

export interface CancelacionVista {
  reserva: {
    /** AAAA-MM-DD */
    fecha: string;
    /** HH:mm */
    horaInicio: string;
    servicio: string | null;
    sucursal: string | null;
    empresa: string | null;
    estado: string | null;
  };
  puedeCancelar: boolean;
  motivo: MotivoNoCancelable | null;
  limite: Date;
  plazoHoras: number;
  reembolso: { monto: number } | null;
}

export interface CancelacionRealizada {
  estado: 'Cancelada';
  reembolso: { monto: number; estado: string } | null;
}

/** Valor por defecto de ConfiguracionEmpresa.TiempoCancelacionHoras. */
const PLAZO_POR_DEFECTO = 24;

/**
 * Tiempo máximo esperando a otra cancelación de la misma reserva. Cubre las dos llamadas
 * a Flow que puede hacer la primera (neto + reembolso), de hasta 15 s cada una.
 */
const ESPERA_LOCK_MS = 40_000;

/** generarToken() de SPEC 04: 32 bytes en hex. Cualquier otra cosa es un token inexistente. */
const FORMATO_TOKEN = /^[0-9a-f]{64}$/;

const MENSAJES: Record<MotivoNoCancelable, string> = {
  FUERA_DE_PLAZO: 'Ya no puedes cancelar esta reserva online',
  YA_CANCELADA: 'Esta reserva ya está cancelada',
  NO_CANCELABLE: 'Esta reserva no se puede cancelar online',
};

function fechaIso(valor: string | Date): string {
  if (valor instanceof Date) {
    return valor.toISOString().slice(0, 10);
  }
  return valor.trim().slice(0, 10);
}

function horaCorta(valor: string | Date): string {
  if (valor instanceof Date) {
    return valor.toISOString().slice(11, 16);
  }
  const [h, m] = valor.trim().split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

/**
 * SPEC 07: cancelación de una reserva desde el enlace del correo, con reembolso del neto
 * del abono Flow. No devuelve datos del cliente. Si Flow no acepta el reembolso, la
 * reserva no se cancela.
 */
@Injectable()
export class CancelacionPublicaService {
  private readonly logger = new Logger(CancelacionPublicaService.name);

  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Pago)
    private readonly pagoRepo: Repository<Pago>,
    private readonly reembolsos: ReembolsosService,
    private readonly dataSource: DataSource,
    private readonly correos: ReservaCorreosService,
  ) {}

  /** GET /reservar/cancelacion/:token */
  async consultar(token: string): Promise<CancelacionVista> {
    const reserva = await this.buscarPorToken(token);
    const plazoHoras = await this.plazoHoras(reserva);
    const limite = limiteCancelacion(
      reserva.fecha,
      reserva.horaInicio,
      plazoHoras,
    );
    const motivo = this.motivo(reserva, limite);
    const pago = await this.pagoReembolsable(reserva.id);
    const monto = pago ? await this.reembolsos.reembolsable(pago) : 0;

    return {
      reserva: {
        fecha: fechaIso(reserva.fecha),
        horaInicio: horaCorta(reserva.horaInicio),
        servicio: reserva.servicio?.nombre ?? null,
        sucursal: reserva.sucursal?.nombre ?? null,
        empresa:
          reserva.empresa?.nombreComercial?.trim() ||
          reserva.empresa?.nombre ||
          null,
        estado: reserva.estado?.nombre ?? null,
      },
      puedeCancelar: motivo === null,
      motivo,
      limite,
      plazoHoras,
      reembolso: monto > 0 ? { monto } : null,
    };
  }

  /**
   * POST /reservar/cancelacion/:token. Las cancelaciones de una misma reserva se
   * serializan con un lock de aplicación: un doble clic espera a la primera y después
   * ve la reserva Cancelada (409) o, si la primera falló, lo intenta de nuevo.
   */
  async cancelar(token: string): Promise<CancelacionRealizada> {
    const { id } = await this.buscarPorToken(token);

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      // El lock vive en esta transacción, que no toca filas: el trabajo va por otras conexiones.
      await runner.startTransaction();
      // sp_getapplock: 0 o 1 = obtenido; negativo = timeout, interbloqueo o error.
      const filas = (await runner.query(
        "DECLARE @r INT; EXEC @r = sp_getapplock @Resource = @0, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = @1; SELECT @r AS resultado",
        [`cancelacion-reserva-${id}`, ESPERA_LOCK_MS],
      )) as { resultado: number }[];
      const resultado = filas[0]?.resultado ?? -999;
      if (resultado < 0) {
        throw new ServiceUnavailableException(
          'Hay otra cancelación de esta reserva en curso. Inténtalo de nuevo en un momento',
        );
      }
      return await this.cancelarConLock(id);
    } finally {
      // Commit o rollback liberan el lock; la transacción no modificó nada.
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction().catch((error: unknown) => {
          this.logger.warn(
            `No se pudo liberar el lock de cancelación de la reserva ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      }
      await runner.release();
    }
  }

  private async cancelarConLock(
    reservaId: number,
  ): Promise<CancelacionRealizada> {
    // Se vuelve a leer: otra petición pudo cancelarla mientras se esperaba el lock.
    const reserva = await this.reservaRepo.findOne({
      where: { id: reservaId },
      relations: { estado: true, empresa: true },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    const limite = limiteCancelacion(
      reserva.fecha,
      reserva.horaInicio,
      await this.plazoHoras(reserva),
    );
    const motivo = this.motivo(reserva, limite);
    if (motivo) {
      throw new ConflictException({ message: MENSAJES[motivo], motivo });
    }

    // Si Flow no acepta el reembolso, solicitar lanza 502 y la reserva sigue Programada.
    const pago = await this.pagoReembolsable(reserva.id);
    let reembolso: CancelacionRealizada['reembolso'] = null;
    if (pago && (await this.reembolsos.reembolsable(pago)) > 0) {
      const solicitado = await this.reembolsos.solicitar({
        pagoId: pago.id,
        origen: 'Cliente',
      });
      reembolso = { monto: solicitado.monto, estado: solicitado.estado };
    }

    const [programada, cancelada] = await Promise.all([
      this.estadoReserva('Programada'),
      this.estadoReserva('Cancelada'),
    ]);
    const cambio = await cambiarEstado(
      this.reservaRepo.manager,
      Reserva,
      reserva.id,
      cancelada,
      { igualA: programada.id },
    );
    if (!cambio) {
      // El panel la cambió entre la lectura y el UPDATE. El reembolso, si se pidió, queda.
      if (reembolso) {
        this.logger.warn(
          `Reserva ${reserva.id}: se pidió el reembolso pero el estado cambió antes de cancelarla`,
        );
      }
      throw new ConflictException({
        message: MENSAJES.YA_CANCELADA,
        motivo: 'YA_CANCELADA',
      });
    }

    // En segundo plano y después del cambio de estado: un fallo de Resend no revierte nada.
    void this.correos.notificarCancelacionCliente(
      reserva.id,
      reembolso?.monto ?? null,
    );
    return { estado: 'Cancelada', reembolso };
  }

  /** El token se busca por su hash. Un formato inválido responde igual que uno inexistente. */
  private async buscarPorToken(token: string): Promise<Reserva> {
    const reserva = FORMATO_TOKEN.test(token)
      ? await this.reservaRepo.findOne({
          where: { tokenCancelacionHash: hashToken(token) },
          relations: {
            estado: true,
            servicio: true,
            sucursal: true,
            empresa: true,
          },
        })
      : null;
    if (!reserva) {
      throw new NotFoundException('El enlace de cancelación no es válido');
    }
    return reserva;
  }

  private motivo(reserva: Reserva, limite: Date): MotivoNoCancelable | null {
    const estado = reserva.estado?.nombre;
    if (estado === 'Cancelada') {
      return 'YA_CANCELADA';
    }
    if (estado !== 'Programada') {
      return 'NO_CANCELABLE';
    }
    if (Date.now() >= limite.getTime()) {
      return 'FUERA_DE_PLAZO';
    }
    return null;
  }

  private async plazoHoras(reserva: Reserva): Promise<number> {
    if (!reserva.empresa) {
      return PLAZO_POR_DEFECTO;
    }
    const config = await this.configRepo.findOne({
      where: { empresa: { id: reserva.empresa.id } },
    });
    return config?.tiempoCancelacionHoras ?? PLAZO_POR_DEFECTO;
  }

  /** El abono Flow Pagado más reciente de la reserva (normalmente hay uno solo). */
  private async pagoReembolsable(reservaId: number): Promise<Pago | null> {
    return this.pagoRepo.findOne({
      where: {
        reserva: { id: reservaId },
        cuentaFlowId: Not(IsNull()),
        estado: { tipo: 'Pago', nombre: 'Pagado' },
      },
      relations: { estado: true },
      order: { id: 'DESC' },
    });
  }

  private async estadoReserva(nombre: string): Promise<Estado> {
    const estado = await this.estadoRepo.findOne({
      where: { tipo: 'Reserva', nombre },
    });
    if (!estado) {
      throw new InternalServerErrorException(
        `No existe el estado '${nombre}' de tipo 'Reserva'`,
      );
    }
    return estado;
  }
}
