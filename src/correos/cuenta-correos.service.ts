import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CorreosService } from './correos.service';
import { PlantillaCorreo } from './plantillas/layout';
import { restablecerContrasena } from './plantillas/restablecer-contrasena';
import { verificarEmail } from './plantillas/verificar-email';

export interface DestinatarioCuenta {
  nombre: string;
  email: string;
}

const FRONT_URL_POR_DEFECTO = 'http://localhost:4200';

/** Correos de la cuenta del usuario (SPEC 04). Salen siempre con la marca AgendaFlow. */
@Injectable()
export class CuentaCorreosService {
  private readonly logger = new Logger(CuentaCorreosService.name);
  private readonly frontUrl: string;

  constructor(
    private readonly correos: CorreosService,
    configService: ConfigService,
  ) {
    // Sale del entorno y nunca de la petición: una cabecera Host manipulada
    // no puede cambiar el destino de los enlaces.
    const configurada = configService.get<string>('FRONT_URL')?.trim();
    if (!configurada) {
      this.logger.warn(
        `FRONT_URL no está configurada: los enlaces de los correos usarán ${FRONT_URL_POR_DEFECTO}.`,
      );
    }
    this.frontUrl = (configurada || FRONT_URL_POR_DEFECTO).replace(/\/+$/, '');
  }

  /** Nunca lanza: se llama en segundo plano y un fallo no debe afectar la petición. */
  enviarVerificacion(
    destinatario: DestinatarioCuenta,
    token: string,
  ): Promise<boolean> {
    return this.enviar(destinatario, () =>
      verificarEmail({
        nombre: destinatario.nombre,
        enlace: this.enlace('verificar-email', token),
      }),
    );
  }

  /** Nunca lanza: se llama en segundo plano y un fallo no debe afectar la petición. */
  enviarRestablecimiento(
    destinatario: DestinatarioCuenta,
    token: string,
  ): Promise<boolean> {
    return this.enviar(destinatario, () =>
      restablecerContrasena({
        nombre: destinatario.nombre,
        enlace: this.enlace('restablecer-contrasena', token),
      }),
    );
  }

  private enlace(ruta: string, token: string): string {
    return `${this.frontUrl}/${ruta}?token=${encodeURIComponent(token)}`;
  }

  private async enviar(
    destinatario: DestinatarioCuenta,
    armarPlantilla: () => PlantillaCorreo,
  ): Promise<boolean> {
    try {
      return await this.correos.enviar({
        to: destinatario.email,
        fromName: 'AgendaFlow',
        ...armarPlantilla(),
      });
    } catch (err) {
      this.logger.error(
        `No se pudo preparar el correo para ${destinatario.email}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
