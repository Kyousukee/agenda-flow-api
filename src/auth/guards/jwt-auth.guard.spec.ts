import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const basePayload: JwtPayload = {
    sub: 1,
    email: 'ana@correo.cl',
    rolId: 1,
    empresaId: 1,
  };

  function preparar(opciones: {
    payload?: JwtPayload;
    tokenInvalido?: boolean;
    usuario?: Partial<Usuario> | null;
    errorBd?: Error;
    authorization?: string;
  }) {
    const verifyAsync = jest.fn(() =>
      opciones.tokenInvalido
        ? Promise.reject(new Error('jwt expired'))
        : Promise.resolve(opciones.payload ?? basePayload),
    );
    const findOne = jest.fn(() =>
      opciones.errorBd
        ? Promise.reject(opciones.errorBd)
        : Promise.resolve(opciones.usuario ?? null),
    );
    const guard = new JwtAuthGuard(
      { verifyAsync } as unknown as JwtService,
      { get: () => 'secreto' } as unknown as ConfigService,
      { findOne } as unknown as Repository<Usuario>,
    );
    const request: Record<string, unknown> = {
      headers: {
        authorization:
          'authorization' in opciones
            ? opciones.authorization
            : 'Bearer token-de-prueba',
      },
    };
    const contexto = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, contexto, request, findOne };
  }

  it('deja pasar si la versión coincide y deja el payload en la petición', async () => {
    const payload = { ...basePayload, tokenVersion: 2 };
    const { guard, contexto, request } = preparar({
      payload,
      usuario: { id: 1, tokenVersion: 2 },
    });

    await expect(guard.canActivate(contexto)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });

  it('un JWT sin tokenVersion vale si la cuenta tiene TokenVersion = 0', async () => {
    const { guard, contexto } = preparar({
      usuario: { id: 1, tokenVersion: 0 },
    });

    await expect(guard.canActivate(contexto)).resolves.toBe(true);
  });

  it('un JWT sin tokenVersion responde 401 si la cuenta tiene TokenVersion = 1', async () => {
    const { guard, contexto, request } = preparar({
      usuario: { id: 1, tokenVersion: 1 },
    });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('responde 401 si la versión del JWT quedó atrás', async () => {
    const { guard, contexto } = preparar({
      payload: { ...basePayload, tokenVersion: 1 },
      usuario: { id: 1, tokenVersion: 2 },
    });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('responde 401 si el usuario ya no existe', async () => {
    const { guard, contexto } = preparar({ usuario: null });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('responde 401 sin consultar la base de datos si el token no es válido', async () => {
    const { guard, contexto, findOne } = preparar({ tokenInvalido: true });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('responde 401 si no hay token', async () => {
    const { guard, contexto, findOne } = preparar({
      authorization: undefined,
    });

    await expect(guard.canActivate(contexto)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('un error de base de datos no se convierte en 401', async () => {
    const errorBd = new Error('conexión perdida');
    const { guard, contexto } = preparar({ errorBd });

    const error: unknown = await guard
      .canActivate(contexto)
      .catch((e: unknown) => e);

    expect(error).toBe(errorBd);
    expect(error).not.toBeInstanceOf(UnauthorizedException);
  });
});
