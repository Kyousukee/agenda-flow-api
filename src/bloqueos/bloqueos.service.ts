import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bloqueo } from './entities/bloqueo.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto';
import { UpdateBloqueoDto } from './dto/update-bloqueo.dto';

@Injectable()
export class BloqueosService {
  constructor(
    @InjectRepository(Bloqueo)
    private readonly bloqueoRepo: Repository<Bloqueo>,
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
  ) {}

  async findAllByEmpresa(empresaId: number) {
    return this.bloqueoRepo.find({
      where: { empleado: { sucursal: { empresa: { id: empresaId } } } },
      relations: { empleado: true },
      order: { id: 'ASC' },
    });
  }

  async create(dto: CreateBloqueoDto, empresaId: number) {
    const empleado = await this.empleadoRepo.findOne({
      where: { id: dto.empleadoId },
      relations: { sucursal: { empresa: true } },
    });
    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }
    if (empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para crear bloqueos para este empleado',
      );
    }

    const bloqueo = this.bloqueoRepo.create({
      fecha: dto.fecha,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      motivo: dto.motivo,
      empleado,
    });

    return this.bloqueoRepo.save(bloqueo);
  }

  async update(id: number, dto: UpdateBloqueoDto, empresaId: number) {
    const bloqueo = await this.bloqueoRepo.findOne({
      where: { id },
      relations: { empleado: { sucursal: { empresa: true } } },
    });
    if (!bloqueo) {
      throw new NotFoundException('Bloqueo no encontrado');
    }
    if (bloqueo.empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar este bloqueo',
      );
    }

    if (dto.empleadoId !== undefined) {
      const nuevoEmpleado = await this.empleadoRepo.findOne({
        where: { id: dto.empleadoId },
        relations: { sucursal: { empresa: true } },
      });
      if (!nuevoEmpleado) {
        throw new NotFoundException('Empleado no encontrado');
      }
      if (nuevoEmpleado.sucursal.empresa.id !== empresaId) {
        throw new ForbiddenException(
          'No tienes permiso para asignar bloqueos a este empleado',
        );
      }
      bloqueo.empleado = nuevoEmpleado;
    }

    Object.assign(bloqueo, {
      ...(dto.fecha !== undefined && { fecha: dto.fecha }),
      ...(dto.horaInicio !== undefined && { horaInicio: dto.horaInicio }),
      ...(dto.horaFin !== undefined && { horaFin: dto.horaFin }),
      ...(dto.motivo !== undefined && { motivo: dto.motivo }),
    });

    return this.bloqueoRepo.save(bloqueo);
  }

  async remove(id: number, empresaId: number) {
    const bloqueo = await this.bloqueoRepo.findOne({
      where: { id },
      relations: { empleado: { sucursal: { empresa: true } } },
    });
    if (!bloqueo) {
      throw new NotFoundException('Bloqueo no encontrado');
    }
    if (bloqueo.empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar este bloqueo',
      );
    }

    await this.bloqueoRepo.remove(bloqueo);
    return { message: 'Bloqueo eliminado correctamente' };
  }
}
