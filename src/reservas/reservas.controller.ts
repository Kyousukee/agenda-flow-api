import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReservasService } from './reservas.service';
import { UpdateReservaEstadoDto } from './dto/update-reserva-estado.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('reservas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @Get()
  findAll(
    @Query('sucursalId', ParseIntPipe) sucursalId: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.reservasService.findAllBySucursal(
      sucursalId,
      req.user!.empresaId,
    );
  }

  @Patch(':id/estado')
  actualizarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReservaEstadoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.reservasService.actualizarEstado(id, dto, req.user!.empresaId);
  }
}
