import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PagosSuscripcionService } from './pagos-suscripcion.service';
import type { ResultadoMensualidad } from './pagos-suscripcion.service';
import { leerFrontUrl, leerTokenFlow } from '../flow/token-flow';

/** SPEC 06: webhooks de Flow para la mensualidad Pro. Públicos: los llama Flow. */
@Controller('flow/suscripcion')
@SkipThrottle()
export class SuscripcionFlowController {
  private readonly logger = new Logger(SuscripcionFlowController.name);
  private readonly frontUrl: string;

  constructor(
    private readonly pagosSuscripcion: PagosSuscripcionService,
    config: ConfigService,
  ) {
    this.frontUrl = leerFrontUrl(config);
  }

  /** Flow reintenta si no recibe 200: un error al consultar a Flow sale como 5xx a propósito. */
  @Post('confirmacion')
  @HttpCode(HttpStatus.OK)
  async confirmacion(@Body('token') valor: unknown) {
    await this.pagosSuscripcion.procesarToken(leerTokenFlow(valor));
    return { recibido: true };
  }

  /** Flow envía aquí al navegador del dueño. Se procesa igual y se redirige al panel. */
  @Post('retorno')
  async retorno(@Body('token') valor: unknown, @Res() res: Response) {
    const token = leerTokenFlow(valor);
    let estado: ResultadoMensualidad;
    try {
      estado = await this.pagosSuscripcion.procesarToken(token);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.warn(
        `No se pudo procesar el retorno de Flow de la mensualidad: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      estado = 'pendiente';
    }
    res.redirect(
      HttpStatus.SEE_OTHER,
      `${this.frontUrl}/suscripcion/pago?estado=${estado}`,
    );
  }
}
