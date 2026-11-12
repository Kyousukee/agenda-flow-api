/**
 * SPEC 06: cálculo del abono (anticipo) que el cliente paga con Flow al reservar.
 * Funciones puras: sin BD ni Flow, para poder probarlas aisladas.
 */

export type TipoAnticipo = 'Monto' | 'Porcentaje' | 'Completo';

export const TIPOS_ANTICIPO: readonly TipoAnticipo[] = [
  'Monto',
  'Porcentaje',
  'Completo',
];

/** Tiempo que una reserva Pendiente retiene la hora. También es el timeout del link de Flow. */
export const MINUTOS_RETENCION_PAGO = 15;

/** CLP. Confirmar el mínimo vigente en el sandbox de Flow. */
export const FLOW_MONTO_MINIMO = 350;

export interface ConfiguracionAnticipo {
  permitePagoAnticipado: boolean;
  tipoAnticipo?: string | null;
  /** Monto fijo en CLP (tipo Monto) o porcentaje 1-100 (tipo Porcentaje). */
  montoAnticipo?: number | string | null;
}

export function esTipoAnticipo(valor: unknown): valor is TipoAnticipo {
  return TIPOS_ANTICIPO.includes(valor as TipoAnticipo);
}

/** Redondeo hacia arriba a pesos enteros, tolerando el error de coma flotante (2997.0000000004 → 2997). */
function pesosHaciaArriba(valor: number): number {
  return Math.ceil(valor - 1e-9);
}

/**
 * Monto en pesos enteros a cobrar al reservar, o null si no se cobra:
 * - Monto: min(MontoAnticipo, precio).
 * - Porcentaje: ceil(precio × MontoAnticipo / 100).
 * - Completo: precio.
 * Devuelve null si el anticipo está desactivado, el tipo no es válido, el precio es 0
 * o el resultado es menor que el mínimo de Flow.
 */
export function calcularAbono(
  precio: number | string,
  config: ConfiguracionAnticipo,
): number | null {
  const precioNumero = Number(precio);
  if (!config.permitePagoAnticipado || !esTipoAnticipo(config.tipoAnticipo)) {
    return null;
  }
  if (!Number.isFinite(precioNumero) || precioNumero <= 0) {
    return null;
  }

  const montoConfig = Number(config.montoAnticipo ?? 0);
  let abono: number;
  switch (config.tipoAnticipo) {
    case 'Monto':
      abono = Math.min(montoConfig, precioNumero);
      break;
    case 'Porcentaje':
      abono = (precioNumero * montoConfig) / 100;
      break;
    case 'Completo':
      abono = precioNumero;
      break;
  }

  const enPesos = pesosHaciaArriba(abono);
  if (!Number.isFinite(enPesos) || enPesos < FLOW_MONTO_MINIMO) {
    return null;
  }
  return enPesos;
}
