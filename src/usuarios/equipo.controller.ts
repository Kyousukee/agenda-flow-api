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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROL_ADMIN } from '../auth/roles';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EquipoService } from './equipo.service';
import { CreateMiembroEquipoDto } from './dto/create-miembro-equipo.dto';
import { UpdateMiembroEquipoDto } from './dto/update-miembro-equipo.dto';

/** SPEC 08: el dueño invita y administra a los recepcionistas de su empresa. */
@Controller('equipo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROL_ADMIN)
export class EquipoController {
  constructor(private readonly equipo: EquipoService) {}

  @Get()
  listar(@Req() req: { user?: JwtPayload }) {
    return this.equipo.listar(req.user!);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  invitar(
    @Body() dto: CreateMiembroEquipoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.equipo.invitar(req.user!, dto);
  }

  @Patch(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMiembroEquipoDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.equipo.actualizar(req.user!, id, dto);
  }

  @Post(':id/reenviar-invitacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  reenviarInvitacion(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.equipo.reenviarInvitacion(req.user!, id);
  }
}
