import { ForbiddenException } from '@nestjs/common';
import { validarAlcanceSucursal } from './alcance-sucursal';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from './roles';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const EMPRESA = 1;

const usuario = (over: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 9,
  email: 'u@example.com',
  rolId: ROL_ADMIN,
  empresaId: EMPRESA,
  ...over,
});

const sucursal = (id: number, empresaId: number | null = EMPRESA) => ({
  id,
  empresa: empresaId === null ? null : { id: empresaId },
});

describe('validarAlcanceSucursal', () => {
  it('el dueño accede a cualquier sucursal de su empresa', () => {
    expect(() =>
      validarAlcanceSucursal(usuario({ sucursalId: 10 }), sucursal(20)),
    ).not.toThrow();
  });

  it('nadie accede a una sucursal de otra empresa', () => {
    expect(() => validarAlcanceSucursal(usuario(), sucursal(10, 2))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      validarAlcanceSucursal(
        usuario({ rolId: ROL_RECEPCIONISTA, sucursalId: 10 }),
        sucursal(10, 2),
      ),
    ).toThrow(ForbiddenException);
  });

  it('una sucursal sin empresa cargada queda fuera de alcance', () => {
    expect(() => validarAlcanceSucursal(usuario(), sucursal(10, null))).toThrow(
      ForbiddenException,
    );
  });

  it('el recepcionista accede solo a la sucursal de su JWT', () => {
    const recepcionista = usuario({ rolId: ROL_RECEPCIONISTA, sucursalId: 10 });
    expect(() =>
      validarAlcanceSucursal(recepcionista, sucursal(10)),
    ).not.toThrow();
    expect(() => validarAlcanceSucursal(recepcionista, sucursal(11))).toThrow(
      ForbiddenException,
    );
  });

  it('un recepcionista sin sucursal en el JWT no accede a ninguna', () => {
    expect(() =>
      validarAlcanceSucursal(
        usuario({ rolId: ROL_RECEPCIONISTA }),
        sucursal(10),
      ),
    ).toThrow(ForbiddenException);
  });
});
