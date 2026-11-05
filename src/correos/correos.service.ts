import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface CorreoSaliente {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Nombre visible del remitente, p. ej. "Barbería X" → "Barbería X <MAIL_FROM>". */
  fromName: string;
  replyTo?: string;
}

const MAIL_FROM_POR_DEFECTO = 'onboarding@resend.dev';

@Injectable()
export class CorreosService {
  private readonly logger = new Logger(CorreosService.name);
  private readonly resend: Resend | null;
  private readonly mailFrom: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY')?.trim();
    this.mailFrom =
      this.configService.get<string>('MAIL_FROM')?.trim() ||
      MAIL_FROM_POR_DEFECTO;

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY no está configurada: los correos se omitirán.',
      );
    }
  }

  /**
   * Envía un correo vía Resend. Nunca lanza: cualquier error se registra
   * en el log y se devuelve `false`, para no afectar el flujo que lo llamó.
   */
  async enviar(correo: CorreoSaliente): Promise<boolean> {
    if (!this.resend) {
      this.logger.debug(
        `Correo omitido (sin RESEND_API_KEY): "${correo.subject}" → ${correo.to}`,
      );
      return false;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `${this.limpiarNombre(correo.fromName)} <${this.mailFrom}>`,
        to: correo.to,
        subject: correo.subject,
        html: correo.html,
        text: correo.text,
        ...(correo.replyTo && { replyTo: correo.replyTo }),
      });

      if (error) {
        this.logger.error(
          `Resend rechazó "${correo.subject}" → ${correo.to}: [${error.name}] ${error.message}`,
        );
        return false;
      }

      this.logger.log(
        `Correo enviado "${correo.subject}" → ${correo.to} (id ${data?.id})`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Error al enviar "${correo.subject}" → ${correo.to}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Quita caracteres que romperían el encabezado "Nombre <email>". */
  private limpiarNombre(nombre: string): string {
    const limpio = nombre.replace(/["<>\r\n]/g, '').trim();
    return limpio || 'AgendaFlow';
  }
}
