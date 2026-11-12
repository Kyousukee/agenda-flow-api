import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoEstadoDto } from './dto/update-pago-estado.dto';
import { ReembolsarPagoDto } from './dto/reembolsar-pago.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('pagos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePagoDto, @Req() req: { user?: JwtPayload }) {
    return this.pagosService.create(dto, req.user!.empresaId);
  }

  @Patch(':id/estado')
  actualizarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePagoEstadoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.pagosService.actualizarEstado(id, dto, req.user!.empresaId);
  }

  /** SPEC 07: reembolso total o parcial de un abono Flow. `cancelarReserva` es opcional. */
  @Post(':id/reembolso')
  @HttpCode(HttpStatus.CREATED)
  reembolsar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReembolsarPagoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.pagosService.reembolsar(
      id,
      dto,
      req.user!.empresaId,
      req.user!.sub,
    );
  }

  /** SPEC 07: historial de reembolsos del pago. Refresca los pendientes con Flow. */
  @Get(':id/reembolsos')
  listarReembolsos(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.pagosService.listarReembolsos(id, req.user!.empresaId);
  }

  @Get('estados')
  obtenerEstados() {
    return this.pagosService.obtenerEstados();
  }

  @Get()
  findAll(
    @Query('sucursalId', ParseIntPipe) sucursalId: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.pagosService.findAllBySucursal(sucursalId, req.user!.empresaId);
  }
}
