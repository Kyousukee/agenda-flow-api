import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empleado } from './entities/empleado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';

@Injectable()
export class EmpleadosService {
  constructor(
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ServicioEmpleado)
    private readonly servicioEmpleadoRepo: Repository<ServicioEmpleado>,
  ) {}

  async findAllByEmpresa(empresaId: number) {
    return this.empleadoRepo.find({
      where: { sucursal: { empresa: { id: empresaId } } },
      relations: { sucursal: true, serviciosEmpleados: { servicio: true } },
      order: { id: 'ASC' },
    });
  }

  async findOne(id: number) {
    const empleado = await this.empleadoRepo.findOne({
      where: { id },
      relations: {
        sucursal: true,
        serviciosEmpleados: { servicio: true },
      },
    });
    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }
    return empleado;
  }

  async create(dto: CreateEmpleadoDto, empresaId: number) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: dto.sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para crear empleados en esta sucursal',
      );
    }

    const empleado = this.empleadoRepo.create({
      nombre: dto.nombre,
      apellido: dto.apellido,
      email: dto.email,
      telefono: dto.telefono,
      foto: dto.foto,
      descripcion: dto.descripcion,
      activo: dto.activo ?? true,
      sucursal,
    });

    const saved = await this.empleadoRepo.save(empleado);

    if (dto.servicioIds && dto.servicioIds.length > 0) {
      const relaciones = dto.servicioIds.map((servicioId) =>
        this.servicioEmpleadoRepo.create({
          servicio: { id: servicioId },
          empleado: saved,
        }),
      );
      await this.servicioEmpleadoRepo.save(relaciones);
    }

    return this.findOne(saved.id);
  }

  async update(id: number, dto: UpdateEmpleadoDto, empresaId: number) {
    const empleado = await this.empleadoRepo.findOne({
      where: { id },
      relations: { sucursal: { empresa: true } },
    });
    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }
    if (empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar este empleado',
      );
    }

    if (dto.sucursalId !== undefined) {
      const nuevaSucursal = await this.sucursalRepo.findOne({
        where: { id: dto.sucursalId },
        relations: { empresa: true },
      });
      if (!nuevaSucursal) {
        throw new NotFoundException('Sucursal no encontrada');
      }
      if (nuevaSucursal.empresa.id !== empresaId) {
        throw new ForbiddenException(
          'No tienes permiso para mover empleados a esta sucursal',
        );
      }
      empleado.sucursal = nuevaSucursal;
    }

    Object.assign(empleado, {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.apellido !== undefined && { apellido: dto.apellido }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.telefono !== undefined && { telefono: dto.telefono }),
      ...(dto.foto !== undefined && { foto: dto.foto }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.activo !== undefined && { activo: dto.activo }),
    });

    await this.empleadoRepo.save(empleado);

    if (dto.servicioIds !== undefined) {
      await this.servicioEmpleadoRepo.delete({ empleado: { id } });

      if (dto.servicioIds.length > 0) {
        const relaciones = dto.servicioIds.map((servicioId) =>
          this.servicioEmpleadoRepo.create({
            servicio: { id: servicioId },
            empleado,
          }),
        );
        await this.servicioEmpleadoRepo.save(relaciones);
      }
    }

    return this.findOne(id);
  }

  async remove(id: number, empresaId: number) {
    const empleado = await this.empleadoRepo.findOne({
      where: { id },
      relations: { sucursal: { empresa: true } },
    });
    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }
    if (empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar este empleado',
      );
    }

    await this.servicioEmpleadoRepo.delete({ empleado: { id } });
    await this.empleadoRepo.remove(empleado);
    return { message: 'Empleado eliminado correctamente' };
  }
}
