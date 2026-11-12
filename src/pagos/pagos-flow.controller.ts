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
import { AbonosService } from './abonos.service';
import { ReembolsosService } from './reembolsos.service';
import { leerFrontUrl, leerTokenFlow } from '../flow/token-flow';

/**
 * Webhooks de Flow para los abonos de reservas (SPEC 06) y sus reembolsos (SPEC 07).
 * Son públicos (los llama Flow) y no confían en el body: los servicios consultan el
 * estado a Flow con las credenciales de la cuenta que firmó el cobro.
 */
@Controller('flow')
@SkipThrottle()
export class PagosFlowController {
  private readonly logger = new Logger(PagosFlowController.name);
  private readonly frontUrl: string;

  constructor(
    private readonly abonos: AbonosService,
    private readonly reembolsos: ReembolsosService,
    config: ConfigService,
  ) {
    this.frontUrl = leerFrontUrl(config);
  }

  /** Flow reintenta si no recibe 200: un error al consultar a Flow sale como 5xx a propósito. */
  @Post('abono/confirmacion')
  @HttpCode(HttpStatus.OK)
  async confirmacion(@Body('token') valor: unknown) {
    await this.abonos.procesarToken(leerTokenFlow(valor));
    return { recibido: true };
  }

  /** Flow envía aquí al navegador del cliente. Se procesa igual y se redirige al front. */
  @Post('abono/retorno')
  async retorno(@Body('token') valor: unknown, @Res() res: Response) {
    const token = leerTokenFlow(valor);
    let codigo: string;
    try {
      ({ codigoReserva: codigo } = await this.abonos.procesarToken(token));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Flow no respondió: el front consulta el estado igual y la confirmación llegará después.
      this.logger.warn(
        `No se pudo procesar el retorno de Flow: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      codigo = await this.abonos.codigoReservaPorToken(token);
    }
    res.redirect(
      HttpStatus.SEE_OTHER,
      `${this.frontUrl}/reserva/pago?codigo=${encodeURIComponent(codigo)}`,
    );
  }

  /** SPEC 07: urlCallBack de refund/create. Un token desconocido responde 404. */
  @Post('reembolso/confirmacion')
  @HttpCode(HttpStatus.OK)
  async confirmacionReembolso(@Body('token') valor: unknown) {
    await this.reembolsos.procesarToken(leerTokenFlow(valor));
    return { recibido: true };
  }
}
