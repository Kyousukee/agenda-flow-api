import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export interface PerfilGoogle {
  /** Identificador estable de la cuenta de Google. */
  sub: string;
  /** En minúsculas. */
  email: string;
  nombre: string;
  apellido?: string;
}

const MENSAJE_INVALIDO = 'No se pudo validar la cuenta de Google';

/**
 * SPEC 05: verifica el ID token que el front obtiene con Google Identity Services.
 * La librería comprueba la firma con las claves públicas de Google, el emisor,
 * la expiración y que el token se emitió para nuestro Client ID.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly cliente = new OAuth2Client();
  private readonly clientId?: string;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID')?.trim() || undefined;
    // Es una función opcional: sin Client ID la API arranca, pero sin login con Google.
    if (!this.clientId) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID no está configurado: el login con Google queda desactivado',
      );
    }
  }

  async verificar(credential: string): Promise<PerfilGoogle> {
    if (!this.clientId) {
      throw new ServiceUnavailableException(
        'El inicio de sesión con Google no está disponible',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.cliente.verifyIdToken({
        idToken: credential,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `ID token de Google rechazado: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException(MENSAJE_INVALIDO);
    }

    // Solo un email verificado por Google permite vincular una cuenta existente.
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException(MENSAJE_INVALIDO);
    }

    const email = payload.email.toLowerCase();
    return {
      sub: payload.sub,
      email,
      nombre: (payload.given_name || payload.name || email.split('@')[0])
        .trim()
        .slice(0, 100),
      apellido: payload.family_name?.trim().slice(0, 100) || undefined,
    };
  }
}
