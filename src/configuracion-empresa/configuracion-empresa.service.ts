import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfiguracionEmpresa } from './entities/configuracion-empresa.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { CreateConfiguracionDto } from './dto/create-configuracion.dto';
import { UpdateConfiguracionDto } from './dto/update-configuracion.dto';

@Injectable()
export class ConfiguracionEmpresaService {
  constructor(
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
  ) {}

  async findByEmpresa(empresaId: number) {
    const config = await this.configRepo.findOne({
      where: { empresa: { id: empresaId } },
      relations: { empresa: true },
    });
    if (!config) {
      throw new NotFoundException(
        'Configuracion no encontrada para esta empresa',
      );
    }
    return config;
  }

  async create(dto: CreateConfiguracionDto, empresaId: number) {
    const existing = await this.configRepo.findOne({
      where: { empresa: { id: empresaId } },
    });
    if (existing) {
      return this.updateConfig(existing, dto);
    }

    const empresa = await this.empresaRepo.findOne({
      where: { id: empresaId },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const config = this.configRepo.create({
      permitePagoAnticipado: dto.permitePagoAnticipado ?? false,
      tipoAnticipo: dto.tipoAnticipo,
      montoAnticipo: dto.montoAnticipo ?? 0,
      tiempoCancelacionHoras: dto.tiempoCancelacionHoras ?? 24,
      tiempoReservaMinutos: dto.tiempoReservaMinutos ?? 30,
      permiteSeleccionEmpleado: dto.permiteSeleccionEmpleado ?? true,
      mostrarPrecios: dto.mostrarPrecios ?? true,
      enviarCorreo: dto.enviarCorreo ?? false,
      enviarWhatsapp: dto.enviarWhatsapp ?? false,
      empresa,
    });

    return this.configRepo.save(config);
  }

  async update(dto: UpdateConfiguracionDto, empresaId: number) {
    const config = await this.configRepo.findOne({
      where: { empresa: { id: empresaId } },
    });
    if (!config) {
      throw new NotFoundException(
        'Configuracion no encontrada para esta empresa',
      );
    }

    return this.updateConfig(config, dto);
  }

  private async updateConfig(
    config: ConfiguracionEmpresa,
    dto: UpdateConfiguracionDto,
  ) {
    Object.assign(config, {
      ...(dto.permitePagoAnticipado !== undefined && {
        permitePagoAnticipado: dto.permitePagoAnticipado,
      }),
      ...(dto.tipoAnticipo !== undefined && { tipoAnticipo: dto.tipoAnticipo }),
      ...(dto.montoAnticipo !== undefined && {
        montoAnticipo: dto.montoAnticipo,
      }),
      ...(dto.tiempoCancelacionHoras !== undefined && {
        tiempoCancelacionHoras: dto.tiempoCancelacionHoras,
      }),
      ...(dto.tiempoReservaMinutos !== undefined && {
        tiempoReservaMinutos: dto.tiempoReservaMinutos,
      }),
      ...(dto.permiteSeleccionEmpleado !== undefined && {
        permiteSeleccionEmpleado: dto.permiteSeleccionEmpleado,
      }),
      ...(dto.mostrarPrecios !== undefined && {
        mostrarPrecios: dto.mostrarPrecios,
      }),
      ...(dto.enviarCorreo !== undefined && {
        enviarCorreo: dto.enviarCorreo,
      }),
      ...(dto.enviarWhatsapp !== undefined && {
        enviarWhatsapp: dto.enviarWhatsapp,
      }),
    });

    return this.configRepo.save(config);
  }
}
