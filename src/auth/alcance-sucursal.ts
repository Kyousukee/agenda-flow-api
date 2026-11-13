import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { ROL_RECEPCIONISTA } from './roles';

/** Lo mínimo de una sucursal para decidir el alcance: su id y su empresa. */
export interface SucursalConEmpresa {
  id: number;
  empresa?: { id: number } | null;
}

export const MENSAJE_FUERA_DE_ALCANCE =
  'No tienes permiso para acceder a esta sucursal';

/**
 * SPEC 08: único punto de control de alcance en los endpoints abiertos al rol 2.
 * - Cualquier rol: la sucursal debe ser de su empresa.
 * - Recepcionista: además debe ser la sucursal de su JWT.
 * La sucursal se pasa con la relación `empresa` cargada.
 */
export function validarAlcanceSucursal(
  user: JwtPayload,
  sucursal: SucursalConEmpresa,
): void {
  if (sucursal.empresa?.id !== user.empresaId) {
    throw new ForbiddenException(MENSAJE_FUERA_DE_ALCANCE);
  }
  if (
    user.rolId === ROL_RECEPCIONISTA &&
    (user.sucursalId === undefined || sucursal.id !== user.sucursalId)
  ) {
    throw new ForbiddenException(MENSAJE_FUERA_DE_ALCANCE);
  }
}
