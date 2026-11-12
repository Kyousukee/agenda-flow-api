/**
 * Helpers de formato para los correos. Aceptan tanto `string` como `Date`
 * porque el driver `mssql` puede devolver columnas `date`/`time` como `Date`.
 * Todo se interpreta en UTC para que la fecha no se corra un día.
 */

const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat('es-CL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat('es-CL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const FORMATO_PRECIO = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function aFechaUtc(valor: string | Date): Date | null {
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? null : valor;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!match) return null;
  const [, anio, mes, dia] = match;
  return new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
}

/** "jueves, 12 de noviembre de 2026" */
export function formatearFecha(valor: string | Date): string {
  const fecha = aFechaUtc(valor);
  return fecha ? FORMATO_FECHA_LARGA.format(fecha) : String(valor);
}

/** "jue, 12 nov" — para asuntos. */
export function formatearFechaCorta(valor: string | Date): string {
  const fecha = aFechaUtc(valor);
  return fecha
    ? FORMATO_FECHA_CORTA.format(fecha).replace(/\./g, '')
    : String(valor);
}

/** "HH:mm" a partir de "HH:mm[:ss]" o de un `Date` (se leen las horas UTC). */
export function formatearHora(valor: string | Date): string {
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    const hh = String(valor.getUTCHours()).padStart(2, '0');
    const mm = String(valor.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const match = /^(\d{1,2}):(\d{2})/.exec(valor.trim());
  if (!match) return valor;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** "$15.000" */
export function formatearPrecio(valor: number | string): string {
  return FORMATO_PRECIO.format(Number(valor));
}

/** SPEC 07: un instante real (no una fecha de reserva) se muestra en la hora del negocio. */
const FORMATO_INSTANTE_CHILE = new Intl.DateTimeFormat('es-CL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Santiago',
});

/** "miércoles, 9 de diciembre de 2026 a las 15:00" (hora de Chile). */
export function formatearInstante(instante: Date): string {
  const partes = Object.fromEntries(
    FORMATO_INSTANTE_CHILE.formatToParts(instante).map((p) => [
      p.type,
      p.value,
    ]),
  );
  return `${partes.weekday}, ${partes.day} de ${partes.month} de ${partes.year} a las ${partes.hour}:${partes.minute}`;
}
