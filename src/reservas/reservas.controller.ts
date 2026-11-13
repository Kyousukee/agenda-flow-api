import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import { ProximaHoraQueryDto } from './dto/proxima-hora-query.dto';
import { CreateReservaPanelDto } from './dto/create-reserva-panel.dto';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from '../auth/roles';

@Controller('reservas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROL_ADMIN)
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  /** SPEC 08: primer hueco de hoy (o de `fecha`) por empleado, con la cola de cada uno. */
  @Get('proxima-hora')
  @Roles(ROL_ADMIN, ROL_RECEPCIONISTA)
  proximaHora(
    @Query() query: ProximaHoraQueryDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.reservasService.proximaHora(req.user!, query);
  }

  /** SPEC 08: reserva presencial o telefónica. Nace Programada, sin abono. */
  @Post()
  @Roles(ROL_ADMIN, ROL_RECEPCIONISTA)
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() dto: CreateReservaPanelDto, @Req() req: { user?: JwtPayload }) {
    return this.reservasService.crearDesdePanel(req.user!, dto);
  }

  @Get()
  @Roles(ROL_ADMIN, ROL_RECEPCIONISTA)
  findAll(
    @Query('sucursalId', ParseIntPipe) sucursalId: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.reservasService.findAllBySucursal(sucursalId, req.user!);
  }

  @Patch(':id/estado')
  @Roles(ROL_ADMIN, ROL_RECEPCIONISTA)
  actualizarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReservaEstadoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.reservasService.actualizarEstado(id, dto, req.user!);
  }
}
