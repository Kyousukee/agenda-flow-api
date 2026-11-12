import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SPEC 06: cifrado de las secretKey de Flow de los locales.
 * AES-256-GCM con IV aleatorio de 12 bytes. Formato guardado: base64(iv | authTag | cifrado).
 */
const ALGORITMO = 'aes-256-gcm';
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_CLAVE = 32;

/** Interpreta FLOW_CREDENCIALES_KEY (base64). Devuelve null si falta o no mide 32 bytes. */
export function leerClave(valor: string | undefined): Buffer | null {
  const texto = valor?.trim();
  if (!texto) {
    return null;
  }
  const clave = Buffer.from(texto, 'base64');
  return clave.length === LARGO_CLAVE ? clave : null;
}

export function cifrar(texto: string, clave: Buffer): string {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64');
}

/** Lanza un error si el dato fue alterado o se cifró con otra clave. */
export function descifrar(base64: string, clave: Buffer): string {
  const datos = Buffer.from(base64, 'base64');
  if (datos.length < LARGO_IV + LARGO_TAG) {
    throw new Error('Dato cifrado inválido');
  }
  const iv = datos.subarray(0, LARGO_IV);
  const tag = datos.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const cifrado = datos.subarray(LARGO_IV + LARGO_TAG);
  const decipher = createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString(
    'utf8',
  );
}

/** Envuelve cifrar/descifrar con la clave de entorno. Sin clave, la API arranca pero sin pagos de locales. */
@Injectable()
export class CifradoCredenciales {
  private readonly logger = new Logger(CifradoCredenciales.name);
  private readonly clave: Buffer | null;

  constructor(config: ConfigService) {
    this.clave = leerClave(config.get<string>('FLOW_CREDENCIALES_KEY'));
    if (!this.clave) {
      this.logger.warn(
        'FLOW_CREDENCIALES_KEY falta o no mide 32 bytes en base64: los abonos con Flow quedan desactivados',
      );
    }
  }

  get disponible(): boolean {
    return this.clave !== null;
  }

  cifrar(texto: string): string {
    return cifrar(texto, this.claveObligatoria());
  }

  descifrar(base64: string): string {
    return descifrar(base64, this.claveObligatoria());
  }

  private claveObligatoria(): Buffer {
    if (!this.clave) {
      throw new ServiceUnavailableException(
        'Los pagos con Flow no están disponibles',
      );
    }
    return this.clave;
  }
}
