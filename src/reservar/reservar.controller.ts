import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReservarService } from './reservar.service';
import { CreateReservaDto } from './dto/create-reserva.dto';
import { UpdateReservaEstadoDto } from './dto/update-reserva-estado.dto';

@Controller('reservar')
export class ReservarController {
  constructor(private readonly reservarService: ReservarService) {}

  @Get('empresa-slug/:slug')
  getEmpresaBySlug(@Param('slug') slug: string) {
    return this.reservarService.getEmpresaBySlug(slug);
  }

  @Get('sucursal/:id')
  getSucursal(@Param('id', ParseIntPipe) id: number) {
    return this.reservarService.getSucursal(id);
  }

  @Get('servicios/:empresaId')
  getServicios(@Param('empresaId', ParseIntPipe) empresaId: number) {
    return this.reservarService.getServiciosByEmpresa(empresaId);
  }

  @Get('empleados/:sucursalId')
  getEmpleados(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.reservarService.getEmpleadosBySucursal(sucursalId);
  }

  @Get('horarios/:sucursalId')
  getHorarios(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.reservarService.getHorariosBySucursal(sucursalId);
  }

  @Get('bloqueos/:sucursalId')
  getBloqueos(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.reservarService.getBloqueosBySucursal(sucursalId);
  }

  @Get('reservas/:sucursalId')
  getReservasBySucursal(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
  ) {
    return this.reservarService.getReservasBySucursal(sucursalId);
  }

  @Get('servicios-empleados/:sucursalId')
  getServiciosEmpleados(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
  ) {
    return this.reservarService.getServiciosEmpleadosBySucursal(sucursalId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createReserva(@Body() dto: CreateReservaDto) {
    return this.reservarService.createReserva(dto);
  }

  @Patch('reservas/:id/estado')
  actualizarEstadoReserva(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReservaEstadoDto,
  ) {
    return this.reservarService.actualizarEstadoReserva(id, dto);
  }
}
