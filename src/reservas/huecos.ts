/**
 * SPEC 08: primer hueco libre de un empleado para un servicio. Todo en minutos desde
 * la medianoche local del negocio. Es una función pura.
 */

export interface Tramo {
  inicio: number;
  fin: number;
}

export interface EntradaHueco {
  /** Desde qué minuto se busca. */
  desde: number;
  /** Servicio.DuracionMinutos. */
  duracion: number;
  /** Horarios abiertos de la sucursal ese día. */
  abiertos: Tramo[];
  /** Reservas activas y bloqueos del empleado ese día. */
  ocupados: Tramo[];
}

export const PASO_MINUTOS = 5;

export function redondearArriba(minutos: number, paso = PASO_MINUTOS): number {
  return Math.ceil(minutos / paso) * paso;
}

export function redondearAbajo(minutos: number, paso = PASO_MINUTOS): number {
  return Math.floor(minutos / paso) * paso;
}

/**
 * Menor inicio `c >= desde` tal que `[c, c + duracion]` cabe en un tramo abierto y no
 * se cruza con ningún ocupado. Los candidatos son `desde`, el inicio de cada tramo
 * abierto y el fin de cada ocupado. `null` si no hay ninguno.
 */
export function primerHueco({
  desde,
  duracion,
  abiertos,
  ocupados,
}: EntradaHueco): number | null {
  if (duracion <= 0) {
    return null;
  }
  const candidatos = [
    desde,
    ...abiertos.map((a) => a.inicio),
    ...ocupados.map((o) => o.fin),
  ]
    .filter((c) => c >= desde)
    .sort((a, b) => a - b);

  for (const inicio of candidatos) {
    const fin = inicio + duracion;
    const cabe = abiertos.some((a) => a.inicio <= inicio && fin <= a.fin);
    const libre = !ocupados.some((o) => o.inicio < fin && o.fin > inicio);
    if (cabe && libre) {
      return inicio;
    }
  }
  return null;
}
