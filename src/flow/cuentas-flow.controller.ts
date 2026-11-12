import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CuentasFlowService } from './cuentas-flow.service';
import { GuardarCuentaFlowDto } from './dto/guardar-cuenta-flow.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

/** SPEC 06: cuentas Flow que reciben los abonos de la empresa y de cada sucursal. */
@Controller('configuracion-empresa/flow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class CuentasFlowController {
  constructor(private readonly cuentasFlow: CuentasFlowService) {}

  @Get()
  listar(@Req() req: { user?: JwtPayload }) {
    return this.cuentasFlow.listar(req.user!.empresaId);
  }

  @Put('empresa')
  guardarEmpresa(
    @Body() dto: GuardarCuentaFlowDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.cuentasFlow.guardarEmpresa(req.user!.empresaId, dto);
  }

  @Delete('empresa')
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarEmpresa(@Req() req: { user?: JwtPayload }) {
    return this.cuentasFlow.quitarEmpresa(req.user!.empresaId);
  }

  @Put('sucursales/:sucursalId')
  guardarSucursal(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
    @Body() dto: GuardarCuentaFlowDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.cuentasFlow.guardarSucursal(
      req.user!.empresaId,
      sucursalId,
      dto,
    );
  }

  @Delete('sucursales/:sucursalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarSucursal(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.cuentasFlow.quitarSucursal(req.user!.empresaId, sucursalId);
  }
}
