import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfiguracionEmpresa } from './entities/configuracion-empresa.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { CreateConfiguracionDto } from './dto/create-configuracion.dto';
import { UpdateConfiguracionDto } from './dto/update-configuracion.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { PAGOS_ONLINE_POR_PLAN } from '../suscripciones/planes';
import { PagosOnlinePlanException } from '../suscripciones/suscripcion-limite.exception';
import { CuentasFlowService } from '../flow/cuentas-flow.service';
import { esTipoAnticipo } from '../pagos/abonos';

const LOGO_FOLDER = 'agendaflow/logos';

@Injectable()
export class ConfiguracionEmpresaService {
  constructor(
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly suscripcionesService: SuscripcionesService,
    private readonly cuentasFlow: CuentasFlowService,
  ) {}

  async uploadLogo(file: Express.Multer.File, empresaId: number) {
    const empresa = await this.getEmpresa(empresaId);
    const result = await this.cloudinaryService.uploadImage(
      file,
      LOGO_FOLDER,
      `empresa-${empresaId}`,
    );
    empresa.logo = result.secure_url;
    await this.empresaRepo.save(empresa);
    return { logo: empresa.logo };
  }

  async deleteLogo(empresaId: number) {
    const empresa = await this.getEmpresa(empresaId);
    if (!empresa.logo) return;
    await this.cloudinaryService.deleteImage(
      `${LOGO_FOLDER}/empresa-${empresaId}`,
    );
    await this.empresaRepo.update(empresaId, {
      logo: null as unknown as string,
    });
  }

  private async getEmpresa(empresaId: number) {
    const empresa = await this.empresaRepo.findOne({
      where: { id: empresaId },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }
    return empresa;
  }

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
      return this.updateConfig(existing, dto, empresaId);
    }

    const empresa = await this.empresaRepo.findOne({
      where: { id: empresaId },
    });
    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const config = this.configRepo.create({
      permitePagoAnticipado: dto.permitePagoAnticipado ?? false,
      pagoObligatorio: dto.pagoObligatorio ?? true,
      tipoAnticipo: dto.tipoAnticipo ?? undefined,
      montoAnticipo: dto.montoAnticipo ?? 0,
      tiempoCancelacionHoras: dto.tiempoCancelacionHoras ?? 24,
      tiempoReservaMinutos: dto.tiempoReservaMinutos ?? 30,
      permiteSeleccionEmpleado: dto.permiteSeleccionEmpleado ?? true,
      mostrarPrecios: dto.mostrarPrecios ?? true,
      enviarCorreo: dto.enviarCorreo ?? false,
      enviarWhatsapp: dto.enviarWhatsapp ?? false,
      empresa,
    });

    await this.validarAnticipo(config, empresaId);
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

    return this.updateConfig(config, dto, empresaId);
  }

  private async updateConfig(
    config: ConfiguracionEmpresa,
    dto: UpdateConfiguracionDto,
    empresaId: number,
  ) {
    Object.assign(config, {
      ...(dto.permitePagoAnticipado !== undefined && {
        permitePagoAnticipado: dto.permitePagoAnticipado,
      }),
      ...(dto.pagoObligatorio !== undefined && {
        pagoObligatorio: dto.pagoObligatorio,
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

    await this.validarAnticipo(config, empresaId);
    return this.configRepo.save(config);
  }

  /**
   * SPEC 06: reglas cuando la configuración queda con PermitePagoAnticipado = true.
   * Se valida el resultado final (lo guardado + el cambio), no solo el body.
   */
  private async validarAnticipo(
    config: ConfiguracionEmpresa,
    empresaId: number,
  ): Promise<void> {
    if (!config.permitePagoAnticipado) {
      return;
    }

    const tipo = config.tipoAnticipo;
    if (!esTipoAnticipo(tipo)) {
      throw new BadRequestException(
        'Elige el tipo de anticipo: Monto, Porcentaje o Completo',
      );
    }
    const monto = Number(config.montoAnticipo);
    if (tipo === 'Monto' && !(Number.isInteger(monto) && monto >= 1)) {
      throw new BadRequestException(
        'El monto del anticipo debe ser un número entero de pesos mayor o igual a 1',
      );
    }
    if (
      tipo === 'Porcentaje' &&
      !(Number.isInteger(monto) && monto >= 1 && monto <= 100)
    ) {
      throw new BadRequestException(
        'El porcentaje del anticipo debe ser un número entero entre 1 y 100',
      );
    }

    const suscripcion =
      await this.suscripcionesService.obtenerVigente(empresaId);
    if (!PAGOS_ONLINE_POR_PLAN[suscripcion.plan]) {
      throw new PagosOnlinePlanException(suscripcion.plan);
    }

    const sinCuenta = await this.cuentasFlow.sucursalesSinCuenta(empresaId);
    if (sinCuenta.length > 0) {
      const nombres = sinCuenta
        .map((s) => s.nombre ?? `Sucursal ${s.id}`)
        .join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `Configura una cuenta Flow para el negocio o para estas sucursales: ${nombres}`,
        sucursalesSinCuenta: sinCuenta,
      });
    }
  }
}
