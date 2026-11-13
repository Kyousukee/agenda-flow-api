import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoEstadoDto } from './dto/update-pago-estado.dto';
import { ReembolsarPagoDto } from './dto/reembolsar-pago.dto';
import { ReembolsosService } from './reembolsos.service';
import type { ReembolsoSolicitado } from './reembolsos.service';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { validarAlcanceSucursal } from '../auth/alcance-sucursal';
import { ROL_RECEPCIONISTA } from '../auth/roles';

/** SPEC 07: estados de reserva sobre los que `cancelarReserva` no hace nada. */
const RESERVA_YA_TERMINADA = ['Cancelada', 'Anulado'];

export interface ResultadoReembolsoPanel {
  reembolso: ReembolsoSolicitado;
  reserva: { estado: string | null };
}

@Injectable()
export class PagosService {
  constructor(
    @InjectRepository(Pago)
    private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly reembolsos: ReembolsosService,
    private readonly correos: ReservaCorreosService,
  ) {}

  async obtenerEstados() {
    const estados = await this.estadoRepo.find({
      where: { tipo: 'Pago', activo: true },
      order: { orden: 'ASC' },
    });
    return estados.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color }));
  }

  /** Un pago solo admite estados de tipo Pago: el catálogo también tiene los de reservas y usuarios. */
  private async obtenerEstadoDePago(estadoId: number): Promise<Estado> {
    const estado = await this.estadoRepo.findOne({ where: { id: estadoId } });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }
    if (estado.tipo !== 'Pago') {
      throw new BadRequestException('El estado no es válido para un pago');
    }
    return estado;
  }

  /** Registrar un pago significa que se recibió, salvo que se indique otro estado. */
  private async obtenerEstadoInicial(): Promise<Estado> {
    const estado = await this.estadoRepo.findOne({
      where: { tipo: 'Pago', nombre: 'Pagado' },
    });
    if (!estado) {
      throw new InternalServerErrorException(
        "No existe el estado 'Pagado' de tipo 'Pago'",
      );
    }
    return estado;
  }

  async create(dto: CreatePagoDto, user: JwtPayload) {
    const reserva = await this.reservaRepo.findOne({
      where: { id: dto.reservaId },
      relations: { sucursal: { empresa: true } },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (reserva.sucursal?.empresa?.id !== user.empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para registrar pagos en esta reserva',
      );
    }
    // SPEC 08: el recepcionista solo registra pagos de su sucursal.
    validarAlcanceSucursal(user, reserva.sucursal);

    const estado = dto.estadoId
      ? await this.obtenerEstadoDePago(dto.estadoId)
      : await this.obtenerEstadoInicial();

    const pago = this.pagoRepo.create({
      monto: dto.monto,
      metodoPago: dto.metodoPago,
      codigoTransaccion: dto.codigoTransaccion,
      fechaPago: dto.fechaPago,
      reserva,
      estado,
    });

    return this.pagoRepo.save(pago);
  }

  async actualizarEstado(
    id: number,
    dto: UpdatePagoEstadoDto,
    user: JwtPayload,
  ) {
    const pago = await this.pagoDeEmpresa(
      id,
      user.empresaId,
      'No tienes permiso para modificar este pago',
    );
    // SPEC 08: el recepcionista solo toca pagos manuales de su sucursal. Los de Flow
    // mueven dinero de la cuenta del local y son del dueño.
    validarAlcanceSucursal(user, pago.reserva.sucursal);
    if (user.rolId === ROL_RECEPCIONISTA && pago.cuentaFlowId) {
      throw new ForbiddenException(
        'Los pagos con Flow solo los puede modificar el administrador',
      );
    }

    const estado = await this.obtenerEstadoDePago(dto.estadoId);
    // SPEC 07: en los pagos Flow, Reembolsado lo calcula el back a partir de los reembolsos.
    if (estado.nombre === 'Reembolsado' && pago.cuentaFlowId) {
      throw new BadRequestException(
        'Los pagos con Flow se reembolsan con POST /pagos/:id/reembolso',
      );
    }
    pago.estado = estado;
    return this.pagoRepo.save(pago);
  }

  /**
   * SPEC 07: reembolso total o parcial de un abono Flow desde el panel, sin plazo y sin
   * depender del plan. Con `cancelarReserva`, la reserva pasa a Cancelada solo si Flow
   * aceptó el reembolso (si Flow falla, `solicitar` lanza 502 antes de llegar aquí).
   */
  async reembolsar(
    id: number,
    dto: ReembolsarPagoDto,
    empresaId: number,
    usuarioId: number,
  ): Promise<ResultadoReembolsoPanel> {
    const pago = await this.pagoDeEmpresa(
      id,
      empresaId,
      'No tienes permiso para reembolsar este pago',
    );

    const reembolso = await this.reembolsos.solicitar({
      pagoId: pago.id,
      monto: dto.monto,
      origen: 'Panel',
      usuarioId,
    });

    const reservaId = pago.reserva.id;
    const cancelada = dto.cancelarReserva
      ? await this.cancelarSiCorresponde(reservaId)
      : false;
    // En segundo plano: el cliente recibe el aviso del reembolso (y de la cancelación).
    void this.correos.notificarReembolso(reservaId, reembolso.monto, cancelada);

    const reserva = await this.reservaRepo.findOne({
      where: { id: reservaId },
      relations: { estado: true },
    });
    return { reembolso, reserva: { estado: reserva?.estado?.nombre ?? null } };
  }

  /** SPEC 07: historial de reembolsos del pago, refrescando antes los pendientes. */
  async listarReembolsos(id: number, empresaId: number) {
    const pago = await this.pagoDeEmpresa(
      id,
      empresaId,
      'No tienes permiso para ver este pago',
    );
    await this.reembolsos.refrescarPendientes(pago.id);
    return this.reembolsos.historial(pago.id);
  }

  /** Pasa la reserva a Cancelada salvo que ya esté Cancelada o Anulado (pago tardío de SPEC 06). */
  /** Devuelve true si esta llamada la canceló. */
  private async cancelarSiCorresponde(reservaId: number): Promise<boolean> {
    const terminados = await this.estadoRepo.find({
      where: RESERVA_YA_TERMINADA.map((nombre) => ({
        tipo: 'Reserva',
        nombre,
      })),
    });
    const cancelada = terminados.find((e) => e.nombre === 'Cancelada');
    if (!cancelada) {
      throw new InternalServerErrorException(
        "No existe el estado 'Cancelada' de tipo 'Reserva'",
      );
    }
    // UPDATE condicional: si otra petición ya la canceló o anuló, no se toca.
    const { affected } = await this.reservaRepo
      .createQueryBuilder()
      .update(Reserva)
      .set({ estado: { id: cancelada.id } })
      .where('Id = :reservaId', { reservaId })
      .andWhere('(EstadoId IS NULL OR EstadoId NOT IN (:...terminados))', {
        terminados: terminados.map((e) => e.id),
      })
      .execute();
    return (affected ?? 0) > 0;
  }

  private async pagoDeEmpresa(
    id: number,
    empresaId: number,
    mensajeAjeno: string,
  ): Promise<Pago> {
    const pago = await this.pagoRepo.findOne({
      where: { id },
      relations: { reserva: { sucursal: { empresa: true } } },
    });
    if (!pago) {
      throw new NotFoundException('Pago no encontrado');
    }
    if (pago.reserva?.sucursal?.empresa?.id !== empresaId) {
      throw new ForbiddenException(mensajeAjeno);
    }
    return pago;
  }

  async findAllBySucursal(sucursalId: number, user: JwtPayload) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== user.empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para ver los pagos de esta sucursal',
      );
    }
    // SPEC 08: el recepcionista solo ve (y exporta) los pagos de su sucursal.
    validarAlcanceSucursal(user, sucursal);

    const pagos = await this.pagoRepo
      .createQueryBuilder('pago')
      .leftJoinAndSelect('pago.reserva', 'reserva')
      .leftJoinAndSelect('reserva.sucursal', 'sucursal')
      .leftJoinAndSelect('reserva.cliente', 'cliente')
      .leftJoinAndSelect('reserva.empleado', 'empleado')
      .leftJoinAndSelect('reserva.servicio', 'servicio')
      .leftJoinAndSelect('pago.estado', 'estado')
      .where('sucursal.id = :sucursalId', { sucursalId })
      .orderBy('pago.fechaPago', 'DESC')
      .getMany();

    // SPEC 07: montoNeto (columna) y montoReembolsado (suma de los Reembolsado).
    const reembolsado = await this.reembolsos.reembolsadoPorPago(
      pagos.map((p) => p.id),
    );
    return pagos.map((pago) => ({
      ...pago,
      montoNeto:
        pago.montoNeto === null || pago.montoNeto === undefined
          ? null
          : Number(pago.montoNeto),
      montoReembolsado: reembolsado.get(pago.id) ?? 0,
    }));
  }
}
