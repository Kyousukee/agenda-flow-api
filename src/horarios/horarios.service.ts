import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Horario } from './entities/horario.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { CreateHorarioDto } from './dto/create-horario.dto';
import { UpdateHorarioDto } from './dto/update-horario.dto';
import { CreateHorariosBatchDto } from './dto/create-horarios-batch.dto';

@Injectable()
export class HorariosService {
  constructor(
    @InjectRepository(Horario)
    private readonly horarioRepo: Repository<Horario>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
  ) {}

  async findAllBySucursal(sucursalId: number) {
    return this.horarioRepo.find({
      where: { sucursal: { id: sucursalId } },
      order: { diaSemana: 'ASC' },
    });
  }

  async createBatch(
    sucursalId: number,
    dto: CreateHorariosBatchDto,
    empresaId: number,
  ) {
    const sucursal = await this.validateSucursalOwnership(
      sucursalId,
      empresaId,
    );

    await this.horarioRepo
      .createQueryBuilder()
      .delete()
      .where('sucursal_id = :sucursalId', { sucursalId })
      .execute();

    const horarios = dto.horarios.map((h) =>
      this.horarioRepo.create({
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        abierto: h.abierto,
        sucursal,
      }),
    );

    return this.horarioRepo.save(horarios);
  }

  async create(sucursalId: number, dto: CreateHorarioDto, empresaId: number) {
    const sucursal = await this.validateSucursalOwnership(
      sucursalId,
      empresaId,
    );

    const horario = this.horarioRepo.create({
      diaSemana: dto.diaSemana,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      abierto: dto.abierto,
      sucursal,
    });

    return this.horarioRepo.save(horario);
  }

  async update(id: string, dto: UpdateHorarioDto, empresaId: number) {
    const horario = await this.horarioRepo.findOne({
      where: { id },
      relations: { sucursal: { empresa: true } },
    });
    if (!horario) {
      throw new NotFoundException('Horario no encontrado');
    }
    if (horario.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar este horario',
      );
    }

    Object.assign(horario, {
      ...(dto.diaSemana !== undefined && { diaSemana: dto.diaSemana }),
      ...(dto.horaInicio !== undefined && { horaInicio: dto.horaInicio }),
      ...(dto.horaFin !== undefined && { horaFin: dto.horaFin }),
      ...(dto.abierto !== undefined && { abierto: dto.abierto }),
    });

    return this.horarioRepo.save(horario);
  }

  async remove(id: string, empresaId: number) {
    const horario = await this.horarioRepo.findOne({
      where: { id },
      relations: { sucursal: { empresa: true } },
    });
    if (!horario) {
      throw new NotFoundException('Horario no encontrado');
    }
    if (horario.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar este horario',
      );
    }

    await this.horarioRepo.remove(horario);
    return { message: 'Horario eliminado correctamente' };
  }

  async removeAllBySucursal(sucursalId: number, empresaId: number) {
    await this.validateSucursalOwnership(sucursalId, empresaId);

    await this.horarioRepo
      .createQueryBuilder()
      .delete()
      .where('sucursal_id = :sucursalId', { sucursalId })
      .execute();
    return { message: 'Horarios eliminados correctamente' };
  }

  private async validateSucursalOwnership(
    sucursalId: number,
    empresaId: number,
  ) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar los horarios de esta sucursal',
      );
    }
    return sucursal;
  }
}
