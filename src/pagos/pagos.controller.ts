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
  UseGuards,
} from '@nestjs/common';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoEstadoDto } from './dto/update-pago-estado.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('pagos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePagoDto) {
    return this.pagosService.create(dto);
  }

  @Patch(':id/estado')
  actualizarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePagoEstadoDto,
  ) {
    return this.pagosService.actualizarEstado(id, dto);
  }

  @Get()
  findAll(@Query('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.pagosService.findAllBySucursal(sucursalId);
  }
}
