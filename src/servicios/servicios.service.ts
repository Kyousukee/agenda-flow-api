import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Servicio } from './entities/servicio.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';

@Injectable()
export class ServiciosService {
  constructor(
    @InjectRepository(Servicio)
    private readonly servicioRepo: Repository<Servicio>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    private readonly suscripcionesService: SuscripcionesService,
  ) {}

  async findAllByEmpresa(empresaId: number) {
    return this.servicioRepo.find({
      where: { empresa: { id: empresaId } },
      order: { id: 'ASC' },
    });
  }

  async create(dto: CreateServicioDto, empresaId: number) {
    const empresa = await this.empresaRepo.findOne({
      where: { id: empresaId },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // SPEC 01: solo cuenta contra el límite si el nuevo servicio queda activo.
    if (dto.activo ?? true) {
      await this.suscripcionesService.validarLimite(empresaId, 'servicios');
    }

    const servicio = this.servicioRepo.create({
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      duracionMinutos: dto.duracionMinutos,
      precio: dto.precio,
      color: dto.color,
      activo: dto.activo ?? true,
      empresa,
    });

    return this.servicioRepo.save(servicio);
  }

  async update(id: number, dto: UpdateServicioDto, empresaId: number) {
    // SPEC 01: resolver un posible vencimiento ANTES de leer el registro, para no
    // reescribir con save() un 'activo' que la degradación acaba de apagar.
    if (dto.activo === true) {
      await this.suscripcionesService.obtenerVigente(empresaId);
    }

    const servicio = await this.servicioRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }
    if (servicio.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar este servicio',
      );
    }

    // SPEC 01: reactivar cuenta contra el límite del plan.
    if (dto.activo === true && !servicio.activo) {
      await this.suscripcionesService.validarLimite(empresaId, 'servicios');
    }
    // Un cambio manual de 'activo' quita la marca de "desactivado por suscripción".
    const cambiaActivo = dto.activo !== undefined && dto.activo !== servicio.activo;

    Object.assign(servicio, {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.duracionMinutos !== undefined && {
        duracionMinutos: dto.duracionMinutos,
      }),
      ...(dto.precio !== undefined && { precio: dto.precio }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.activo !== undefined && { activo: dto.activo }),
      ...(cambiaActivo && { desactivadoPorSuscripcion: false }),
    });

    return this.servicioRepo.save(servicio);
  }

  async remove(id: number, empresaId: number) {
    const servicio = await this.servicioRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }
    if (servicio.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar este servicio',
      );
    }

    await this.servicioRepo.remove(servicio);
    return { message: 'Servicio eliminado correctamente' };
  }
}
