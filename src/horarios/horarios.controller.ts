import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { HorariosService } from './horarios.service';
import { CreateHorarioDto } from './dto/create-horario.dto';
import { UpdateHorarioDto } from './dto/update-horario.dto';
import { CreateHorariosBatchDto } from './dto/create-horarios-batch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class HorariosController {
  constructor(private readonly horariosService: HorariosService) {}

  @Get('sucursales/:sucursalId/horarios')
  findAllBySucursal(@Param('sucursalId', ParseIntPipe) sucursalId: number) {
    return this.horariosService.findAllBySucursal(sucursalId);
  }

  @Post('sucursales/:sucursalId/horarios')
  @HttpCode(HttpStatus.CREATED)
  createBatch(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
    @Body() dto: CreateHorariosBatchDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.horariosService.createBatch(
      sucursalId,
      dto,
      req.user!.empresaId,
    );
  }

  @Post('sucursales/:sucursalId/horarios/single')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
    @Body() dto: CreateHorarioDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.horariosService.create(sucursalId, dto, req.user!.empresaId);
  }

  @Put('horarios/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHorarioDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.horariosService.update(id, dto, req.user!.empresaId);
  }

  @Delete('horarios/:id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.horariosService.remove(id, req.user!.empresaId);
  }

  @Delete('sucursales/:sucursalId/horarios')
  @HttpCode(HttpStatus.OK)
  removeAllBySucursal(
    @Param('sucursalId', ParseIntPipe) sucursalId: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.horariosService.removeAllBySucursal(
      sucursalId,
      req.user!.empresaId,
    );
  }
}
