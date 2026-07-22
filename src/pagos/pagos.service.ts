import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
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
  ) {}

  async create(dto: CreatePagoDto) {
    const reserva = await this.reservaRepo.findOne({
      where: { id: dto.reservaId },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
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

  async actualizarEstado(id: number, dto: UpdatePagoEstadoDto) {
    const pago = await this.pagoRepo.findOne({ where: { id } });
    if (!pago) {
      throw new NotFoundException('Pago no encontrado');
    }

    const estado = await this.estadoRepo.findOne({ where: { id: dto.estadoId } });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }

    pago.estado = estado;
    return this.pagoRepo.save(pago);
  }

  async findAllBySucursal(sucursalId: number) {
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
