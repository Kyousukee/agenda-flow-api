import { ZONA_HORARIA_NEGOCIO } from './cancelacion';

/**
 * SPEC 08: "hoy" y "ahora" del negocio. `Fecha` y `HoraInicio` de las reservas se guardan
 * como hora local de America/Santiago, así que se comparan contra esta hora, no la del servidor.
 */

const FORMATO = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export interface AhoraNegocio {
  /** AAAA-MM-DD en hora de Santiago. */
  fecha: string;
  /** Minutos desde la medianoche local (0–1439). */
  minutos: number;
}

export function ahoraEnNegocio(ahora: Date = new Date()): AhoraNegocio {
  const partes = Object.fromEntries(
    FORMATO.formatToParts(ahora).map((p) => [p.type, p.value]),
  );
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    minutos: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

/**
 * Minutos desde medianoche de una columna `time`: "HH:mm[:ss[.fff]]" o un `Date`
 * (el driver `mssql` puede devolverla así; se leen sus componentes UTC, como en formato.ts).
 */
export function minutosDeHora(valor: string | Date): number {
  if (valor instanceof Date) {
    return valor.getUTCHours() * 60 + valor.getUTCMinutes();
  }
  const [h, m] = valor.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:mm" a partir de minutos desde medianoche. */
export function horaDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
