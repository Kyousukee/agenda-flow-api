import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FRONT_URL_POR_DEFECTO = 'http://localhost:4200';

/** URL pública del front, sin barra final. Nunca se toma de la petición. */
export function leerFrontUrl(config: ConfigService): string {
  return (
    config.get<string>('FRONT_URL')?.trim() || FRONT_URL_POR_DEFECTO
  ).replace(/\/+$/, '');
}

/**
 * SPEC 06: lee el `token` que Flow envía (form-urlencoded) a urlConfirmation y urlReturn.
 * Se lee con @Body('token') y no con un DTO a propósito: el ValidationPipe global
 * rechaza campos extra (forbidNonWhitelisted), y si Flow agregara uno, sus avisos
 * fallarían para siempre. Aquí se ignora cualquier otro campo.
 */
export function leerTokenFlow(valor: unknown): string {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 100) {
    throw new BadRequestException('token inválido');
  }
  return valor.trim();
}
