import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { SucursalesService } from './sucursales.service';
import { CreateSucursalDto } from './dto/create-sucursal.dto';
import { UpdateSucursalDto } from './dto/update-sucursal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('sucursales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class SucursalesController {
  constructor(private readonly sucursalesService: SucursalesService) {}

  @Get()
  findAll(@Req() req: { user?: JwtPayload }) {
    return this.sucursalesService.findAllByEmpresa(req.user!.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSucursalDto, @Req() req: { user?: JwtPayload }) {
    return this.sucursalesService.create(dto, req.user!.empresaId);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSucursalDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.sucursalesService.update(id, dto, req.user!.empresaId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.sucursalesService.remove(id, req.user!.empresaId);
  }
}
