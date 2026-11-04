import type { PlanSuscripcion } from './entities/suscripcion.entity';

export type { PlanSuscripcion };
export type RecursoLimitado = 'sucursales' | 'empleados' | 'servicios';

export const DIAS_PRUEBA = 14;
export const DIAS_AVISO = 3;

// null = ilimitado
export const LIMITES_PLAN: Record<
  PlanSuscripcion,
  Record<RecursoLimitado, number | null>
> = {
  Prueba: { sucursales: null, empleados: null, servicios: null },
  Pro: { sucursales: null, empleados: null, servicios: null },
  Gratis: { sucursales: 1, empleados: 2, servicios: 5 },
};

export const RECURSOS_LIMITADOS: RecursoLimitado[] = [
  'sucursales',
  'empleados',
  'servicios',
];
