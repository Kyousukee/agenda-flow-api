import type { PlanSuscripcion } from './entities/suscripcion.entity';

export type { PlanSuscripcion };
export type RecursoLimitado =
  'sucursales' | 'empleados' | 'servicios' | 'recepcionistas';

export const DIAS_PRUEBA = 14;
export const DIAS_AVISO = 3;

// null = ilimitado. SPEC 08: los recepcionistas (rol 2) son un beneficio de Prueba y Pro.
export const LIMITES_PLAN: Record<
  PlanSuscripcion,
  Record<RecursoLimitado, number | null>
> = {
  Prueba: {
    sucursales: null,
    empleados: null,
    servicios: null,
    recepcionistas: null,
  },
  Pro: {
    sucursales: null,
    empleados: null,
    servicios: null,
    recepcionistas: null,
  },
  Gratis: { sucursales: 1, empleados: 2, servicios: 5, recepcionistas: 0 },
};

export const RECURSOS_LIMITADOS: RecursoLimitado[] = [
  'sucursales',
  'empleados',
  'servicios',
  'recepcionistas',
];

// SPEC 06: mensualidad Pro cobrada con Flow.
export const PRECIO_PRO_CLP = 19990;
export const DIAS_POR_PAGO = 30;

// SPEC 06: los abonos online con Flow son un beneficio de Prueba y Pro.
export const PAGOS_ONLINE_POR_PLAN: Record<PlanSuscripcion, boolean> = {
  Prueba: true,
  Pro: true,
  Gratis: false,
};
