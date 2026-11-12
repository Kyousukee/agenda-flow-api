import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReservarService } from './reservar.service';
import { CreateReservaDto } from './dto/create-reserva.dto';

/**
 * API pública de la página de reservas: no exige sesión, así que no debe devolver
 * datos de clientes ni modificar nada que no sea crear una reserva nueva.
 */
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

  @Get('ocupacion/:sucursalId')
  getOcupacion(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.reservarService.getOcupacionBySucursal(sucursalId);
  }

  @Get('servicios-empleados/:sucursalId')
  getServiciosEmpleados(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.reservarService.getServiciosEmpleadosBySucursal(sucursalId);
  }

  /** SPEC 06: el código es el UUID de la reserva; sin él no se puede adivinar el estado de otra. */
  @Get('reservas/:codigo/pago')
  getEstadoPago(@Param('codigo', ParseUUIDPipe) codigo: string) {
    return this.reservarService.getEstadoPago(codigo);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  createReserva(@Body() dto: CreateReservaDto) {
    return this.reservarService.createReserva(dto);
  }
}
