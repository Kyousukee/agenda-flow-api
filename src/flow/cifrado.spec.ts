import { randomBytes } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CifradoCredenciales, cifrar, descifrar, leerClave } from './cifrado';

describe('cifrado de credenciales Flow', () => {
  const clave = randomBytes(32);

  it('ida y vuelta devuelve el texto original', () => {
    const secreto = 'a1b2c3d4e5f6-secret-ñ';
    expect(descifrar(cifrar(secreto, clave), clave)).toBe(secreto);
  });

  it('el texto cifrado no contiene el secreto y cambia en cada cifrado (IV aleatorio)', () => {
    const secreto = 'mi-secret-key-de-flow';
    const a = cifrar(secreto, clave);
    const b = cifrar(secreto, clave);
    expect(a).not.toContain(secreto);
    expect(Buffer.from(a, 'base64').toString('utf8')).not.toContain(secreto);
    expect(a).not.toBe(b);
  });

  it('un authTag alterado falla', () => {
    const datos = Buffer.from(cifrar('secreto', clave), 'base64');
    datos[12] ^= 0xff; // primer byte del authTag
    expect(() => descifrar(datos.toString('base64'), clave)).toThrow();
  });

  it('otra clave falla', () => {
    const cifrado = cifrar('secreto', clave);
    expect(() => descifrar(cifrado, randomBytes(32))).toThrow();
  });

  it('leerClave exige 32 bytes en base64', () => {
    expect(leerClave(undefined)).toBeNull();
    expect(leerClave('')).toBeNull();
    expect(leerClave(randomBytes(16).toString('base64'))).toBeNull();
    expect(leerClave(clave.toString('base64'))?.equals(clave)).toBe(true);
  });

  it('sin clave, el servicio no está disponible y responde 503', () => {
    const servicio = new CifradoCredenciales({
      get: () => undefined,
    } as unknown as ConfigService);
    expect(servicio.disponible).toBe(false);
    expect(() => servicio.cifrar('x')).toThrow(ServiceUnavailableException);
  });

  it('con clave, el servicio cifra y descifra', () => {
    const servicio = new CifradoCredenciales({
      get: () => clave.toString('base64'),
    } as unknown as ConfigService);
    expect(servicio.disponible).toBe(true);
    expect(servicio.descifrar(servicio.cifrar('abc'))).toBe('abc');
  });
});
