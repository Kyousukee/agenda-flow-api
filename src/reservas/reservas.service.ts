import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { UpdateReservaEstadoDto } from './dto/update-reserva-estado.dto';

@Injectable()
export class ReservasService {
  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly reservaCorreos: ReservaCorreosService,
  ) {}

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
        'No tienes permiso para ver las reservas de esta sucursal',
      );
    }

    return this.reservaRepo.find({
      where: { sucursal: { id: sucursalId } },
      relations: {
        cliente: true,
        empleado: true,
        servicio: true,
        estado: true,
        sucursal: true,
        pagos: true,
      },
      order: { fecha: 'DESC', horaInicio: 'ASC' },
    });
  }

  async actualizarEstado(
    id: number,
    dto: UpdateReservaEstadoDto,
    empresaId: number,
  ) {
    const reserva = await this.reservaRepo.findOne({
      where: { id },
      relations: { estado: true, sucursal: { empresa: true } },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (reserva.sucursal?.empresa?.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar esta reserva',
      );
    }

    const estado = await this.estadoRepo.findOne({
      where: { id: dto.estadoId },
    });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }
    if (estado.tipo !== 'Reserva') {
      throw new BadRequestException('El estado no es válido para una reserva');
    }

    // SPEC 02: si el estado no cambia, no se guarda ni se notifica.
    if (reserva.estado?.id === estado.id) {
      return reserva;
    }

    reserva.estado = estado;
    const saved = await this.reservaRepo.save(reserva);

    // SPEC 02: correos en segundo plano; un fallo de envío no afecta el cambio.
    void this.reservaCorreos.notificarCambioEstado(saved.id);

    return saved;
  }
}
