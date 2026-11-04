import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SuscripcionesService } from './suscripciones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('suscripcion')
@UseGuards(JwtAuthGuard)
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}

  @Get()
  obtener(@Req() req: { user?: JwtPayload }) {
    return this.suscripcionesService.obtenerResumen(req.user!.empresaId);
  }
}
