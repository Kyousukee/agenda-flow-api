import { ForbiddenException } from '@nestjs/common';
import { PlanSuscripcion, RecursoLimitado } from './planes';

export const SUSCRIPCION_LIMITE = 'SUSCRIPCION_LIMITE';

// Texto con concordancia correcta: "1 sucursal activa", "5 servicios activos".
const ETIQUETAS: Record<RecursoLimitado, { singular: string; plural: string }> =
  {
    sucursales: { singular: 'sucursal activa', plural: 'sucursales activas' },
    empleados: { singular: 'empleado activo', plural: 'empleados activos' },
    servicios: { singular: 'servicio activo', plural: 'servicios activos' },
    recepcionistas: {
      singular: 'recepcionista activo',
      plural: 'recepcionistas activos',
    },
  };

/** SPEC 08: con límite 0 el recurso no está incluido en el plan. */
const NO_INCLUIDO: Partial<Record<RecursoLimitado, string>> = {
  recepcionistas: 'recepcionistas',
};

/**
 * 403 que se lanza cuando una acción supera el límite del plan vigente.
 * El `code` es estable para que el front lo distinga de otros 403.
 */
export class SuscripcionLimiteException extends ForbiddenException {
  constructor(
    plan: PlanSuscripcion,
    recurso: RecursoLimitado,
    limite: number,
    actual: number,
  ) {
    const { singular, plural } = ETIQUETAS[recurso];
    const etiqueta = limite === 1 ? singular : plural;
    const noIncluido = NO_INCLUIDO[recurso];
    super({
      statusCode: 403,
      code: SUSCRIPCION_LIMITE,
      plan,
      recurso,
      limite,
      actual,
      message:
        limite === 0 && noIncluido
          ? `Tu plan ${plan} no incluye ${noIncluido}. Actualiza a Pro para agregarlos.`
          : `Tu plan ${plan} permite hasta ${limite} ${etiqueta}. Actualiza a Pro para agregar más.`,
    });
  }
}

/**
 * SPEC 06: 403 al activar los pagos online en un plan que no los incluye.
 * Mismo `code` que los límites para que el front lo trate igual; `recurso` lo distingue.
 */
export class PagosOnlinePlanException extends ForbiddenException {
  constructor(plan: PlanSuscripcion) {
    super({
      statusCode: 403,
      code: SUSCRIPCION_LIMITE,
      plan,
      recurso: 'pagosOnline',
      limite: 0,
      actual: 0,
      message: 'Los pagos online están disponibles en el plan Pro.',
    });
  }
}
