import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ConfiguracionEmpresaService } from './configuracion-empresa.service';
import { CreateConfiguracionDto } from './dto/create-configuracion.dto';
import { UpdateConfiguracionDto } from './dto/update-configuracion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('configuracion-empresa')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class ConfiguracionEmpresaController {
  constructor(
    private readonly configService: ConfiguracionEmpresaService,
  ) {}

  @Get()
  find(@Req() req: { user?: JwtPayload }) {
    return this.configService.findByEmpresa(req.user!.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateConfiguracionDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.configService.create(dto, req.user!.empresaId);
  }

  @Put()
  update(
    @Body() dto: UpdateConfiguracionDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.configService.update(dto, req.user!.empresaId);
  }
}
