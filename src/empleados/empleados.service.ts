import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Empleado } from './entities/empleado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';

@Injectable()
export class EmpleadosService {
  constructor(
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(ServicioEmpleado)
    private readonly servicioEmpleadoRepo: Repository<ServicioEmpleado>,
    @InjectRepository(Servicio)
    private readonly servicioRepo: Repository<Servicio>,
    private readonly suscripcionesService: SuscripcionesService,
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
        'No tienes permiso para ver los empleados de esta sucursal',
      );
    }

    return this.empleadoRepo.find({
      where: { sucursal: { id: sucursalId } },
      relations: { serviciosEmpleados: { servicio: true } },
      order: { id: 'ASC' },
    });
  }

  async findOne(id: number, empresaId: number) {
    const empleado = await this.empleadoRepo.findOne({
      where: { id },
      relations: {
        sucursal: { empresa: true },
        serviciosEmpleados: { servicio: true },
      },
    });
    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }
    if (empleado.sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para ver este empleado',
      );
    }
    return empleado;
  }

  /** Un empleado solo puede vincularse a servicios de su propia empresa. */
  private async validarServicios(
    servicioIds: number[] | undefined,
    empresaId: number,
  ): Promise<void> {
    if (!servicioIds?.length) return;
    const ids = [...new Set(servicioIds)];
    const propios = await this.servicioRepo.count({
      where: { id: In(ids), empresa: { id: empresaId } },
    });
    if (propios !== ids.length) {
      throw new ForbiddenException(
        'No tienes permiso para asignar alguno de estos servicios',
      );
    }
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
    await this.validarServicios(dto.servicioIds, empresaId);

    // SPEC 01: solo cuenta contra el límite si el nuevo empleado queda activo.
    if (dto.activo ?? true) {
      await this.suscripcionesService.validarLimite(empresaId, 'empleados');
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

    return this.findOne(saved.id, empresaId);
  }

  async update(id: number, dto: UpdateEmpleadoDto, empresaId: number) {
    // SPEC 01: resolver un posible vencimiento ANTES de leer el registro, para no
    // reescribir con save() un 'activo' que la degradación acaba de apagar.
    if (dto.activo === true) {
      await this.suscripcionesService.obtenerVigente(empresaId);
    }

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

    // SPEC 01: reactivar cuenta contra el límite del plan.
    if (dto.activo === true && !empleado.activo) {
      await this.suscripcionesService.validarLimite(empresaId, 'empleados');
    }
    // Un cambio manual de 'activo' quita la marca de "desactivado por suscripción".
    const cambiaActivo = dto.activo !== undefined && dto.activo !== empleado.activo;

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
      ...(cambiaActivo && { desactivadoPorSuscripcion: false }),
    });

    await this.empleadoRepo.save(empleado);

    if (dto.servicioIds !== undefined) {
      await this.validarServicios(dto.servicioIds, empresaId);
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

    return this.findOne(id, empresaId);
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
