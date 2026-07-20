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
import { BloqueosService } from './bloqueos.service';
import { CreateBloqueoDto } from './dto/create-bloqueo.dto';
import { UpdateBloqueoDto } from './dto/update-bloqueo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('bloqueos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class BloqueosController {
  constructor(private readonly bloqueosService: BloqueosService) {}

  @Get()
  findAll(@Req() req: { user?: JwtPayload }) {
    return this.bloqueosService.findAllByEmpresa(req.user!.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateBloqueoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.bloqueosService.create(dto, req.user!.empresaId);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBloqueoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.bloqueosService.update(id, dto, req.user!.empresaId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.bloqueosService.remove(id, req.user!.empresaId);
  }
}
