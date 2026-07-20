import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sucursal } from './entities/sucursal.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { CreateSucursalDto } from './dto/create-sucursal.dto';
import { UpdateSucursalDto } from './dto/update-sucursal.dto';

@Injectable()
export class SucursalesService {
  constructor(
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
  ) {}

  async findAllByEmpresa(empresaId: number) {
    return this.sucursalRepo.find({
      where: { empresa: { id: empresaId } },
      order: { id: 'ASC' },
    });
  }

  async create(dto: CreateSucursalDto, empresaId: number) {
    const empresa = await this.empresaRepo.findOne({
      where: { id: empresaId },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const sucursal = this.sucursalRepo.create({
      nombre: dto.nombre,
      direccion: dto.direccion,
      comuna: dto.comuna,
      ciudad: dto.ciudad,
      region: dto.region,
      pais: dto.pais,
      latitud: dto.latitud ?? undefined,
      longitud: dto.longitud ?? undefined,
      telefono: dto.telefono,
      activo: dto.activo ?? true,
      empresa,
    });

    return this.sucursalRepo.save(sucursal);
  }

  async update(id: number, dto: UpdateSucursalDto, empresaId: number) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar esta sucursal',
      );
    }

    Object.assign(sucursal, {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.direccion !== undefined && { direccion: dto.direccion }),
      ...(dto.comuna !== undefined && { comuna: dto.comuna }),
      ...(dto.ciudad !== undefined && { ciudad: dto.ciudad }),
      ...(dto.region !== undefined && { region: dto.region }),
      ...(dto.pais !== undefined && { pais: dto.pais }),
      ...(dto.latitud !== undefined && {
        latitud: dto.latitud ?? undefined,
      }),
      ...(dto.longitud !== undefined && {
        longitud: dto.longitud ?? undefined,
      }),
      ...(dto.telefono !== undefined && { telefono: dto.telefono }),
      ...(dto.activo !== undefined && { activo: dto.activo }),
    });

    return this.sucursalRepo.save(sucursal);
  }

  async remove(id: number, empresaId: number) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para eliminar esta sucursal',
      );
    }

    await this.sucursalRepo.remove(sucursal);
    return { message: 'Sucursal eliminada correctamente' };
  }
}
