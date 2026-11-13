import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SuscripcionesService } from './suscripciones.service';
import { PagosSuscripcionService } from './pagos-suscripcion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ROL_ADMIN } from '../auth/roles';

@Controller('suscripcion')
@UseGuards(JwtAuthGuard)
export class SuscripcionesController {
  constructor(
    private readonly suscripcionesService: SuscripcionesService,
    private readonly pagosSuscripcion: PagosSuscripcionService,
  ) {}

  /** SPEC 08: solo el rol 1; el recepcionista no ve la suscripción. */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(ROL_ADMIN)
  obtener(@Req() req: { user?: JwtPayload }) {
    return this.suscripcionesService.obtenerResumen(req.user!.empresaId);
  }

  /** SPEC 06: crea el cobro de la mensualidad Pro y devuelve la URL de Flow. */
  @Post('pagar')
  @UseGuards(RolesGuard)
  @Roles(1)
  pagar(@Req() req: { user?: JwtPayload }) {
    return this.pagosSuscripcion.iniciar(req.user!.empresaId, req.user!.email);
  }

  /** SPEC 06: historial de pagos de la mensualidad, más reciente primero. */
  @Get('pagos')
  @UseGuards(RolesGuard)
  @Roles(1)
  pagos(@Req() req: { user?: JwtPayload }) {
    return this.pagosSuscripcion.listar(req.user!.empresaId);
  }
}
