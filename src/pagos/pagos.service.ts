import {
  ForbiddenException,
  Injectable,
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
  ) {}

  async create(dto: CreatePagoDto, empresaId: number) {
    const reserva = await this.reservaRepo.findOne({
      where: { id: dto.reservaId },
      relations: { sucursal: { empresa: true } },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (reserva.sucursal?.empresa?.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para registrar pagos en esta reserva',
      );
    }

    const pago = this.pagoRepo.create({
      monto: dto.monto,
      metodoPago: dto.metodoPago,
      codigoTransaccion: dto.codigoTransaccion,
      fechaPago: dto.fechaPago,
      reserva,
      estado: dto.estadoId ? ({ id: dto.estadoId } as any) : undefined,
    });

    return this.pagoRepo.save(pago);
  }

  async actualizarEstado(
    id: number,
    dto: UpdatePagoEstadoDto,
    empresaId: number,
  ) {
    const pago = await this.pagoRepo.findOne({
      where: { id },
      relations: { reserva: { sucursal: { empresa: true } } },
    });
    if (!pago) {
      throw new NotFoundException('Pago no encontrado');
    }
    if (pago.reserva?.sucursal?.empresa?.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar este pago',
      );
    }

    const estado = await this.estadoRepo.findOne({ where: { id: dto.estadoId } });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }

    pago.estado = estado;
    return this.pagoRepo.save(pago);
  }

  async findAllBySucursal(sucursalId: number, empresaId: number) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para ver los pagos de esta sucursal',
      );
    }

    return this.pagoRepo
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
  }
}
