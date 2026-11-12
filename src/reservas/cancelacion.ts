/**
 * SPEC 07: plazo de cancelación de una reserva desde el enlace público.
 *
 * `Fecha` y `HoraInicio` se guardan como hora local del negocio (sin zona). Flow opera
 * solo en Chile, así que se interpretan en America/Santiago, con su cambio de horario.
 */

export const ZONA_HORARIA_NEGOCIO = 'America/Santiago';

const HORA_MS = 60 * 60 * 1000;

const FORMATO_ZONA = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA_NEGOCIO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
}

interface PartesHora {
  hora: number;
  minuto: number;
  segundo: number;
}

/** "AAAA-MM-DD" o un `Date` (se leen sus componentes UTC, como en formato.ts). */
function partesFecha(valor: string | Date): PartesFecha {
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) {
      throw new Error('Fecha de reserva inválida');
    }
    return {
      anio: valor.getUTCFullYear(),
      mes: valor.getUTCMonth() + 1,
      dia: valor.getUTCDate(),
    };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!match) {
    throw new Error(`Fecha de reserva inválida: ${valor}`);
  }
  return { anio: +match[1], mes: +match[2], dia: +match[3] };
}

/** "HH:mm[:ss[.fff]]" o un `Date` (se leen sus componentes UTC). */
function partesHora(valor: string | Date): PartesHora {
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) {
      throw new Error('Hora de reserva inválida');
    }
    return {
      hora: valor.getUTCHours(),
      minuto: valor.getUTCMinutes(),
      segundo: valor.getUTCSeconds(),
    };
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(valor.trim());
  if (!match) {
    throw new Error(`Hora de reserva inválida: ${valor}`);
  }
  return { hora: +match[1], minuto: +match[2], segundo: +(match[3] ?? 0) };
}

/** Diferencia (ms) entre la hora local de Santiago y UTC en ese instante. */
function desfaseZona(instante: number): number {
  const partes = Object.fromEntries(
    FORMATO_ZONA.formatToParts(new Date(instante)).map((p) => [
      p.type,
      p.value,
    ]),
  );
  const comoUtc = Date.UTC(
    +partes.year,
    +partes.month - 1,
    +partes.day,
    +partes.hour,
    +partes.minute,
    +partes.second,
  );
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/**
 * Instante (UTC) en que empieza la reserva: `fecha` + `horaInicio` en hora de Santiago.
 * - Hora repetida al volver al horario de invierno: se toma la primera (la más temprana).
 * - Hora inexistente al pasar al horario de verano: se corre hacia adelante el salto.
 */
export function inicioReserva(
  fecha: string | Date,
  horaInicio: string | Date,
): Date {
  const { anio, mes, dia } = partesFecha(fecha);
  const { hora, minuto, segundo } = partesHora(horaInicio);
  const pared = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);

  // Candidatos con los desfases vigentes un día antes y un día después de la hora pedida.
  const desfases = [
    desfaseZona(pared - 24 * HORA_MS),
    desfaseZona(pared + 24 * HORA_MS),
  ];
  const validos = desfases
    .map((desfase) => pared - desfase)
    .filter((instante) => instante + desfaseZona(instante) === pared)
    .sort((a, b) => a - b);
  if (validos.length > 0) {
    return new Date(validos[0]);
  }
  // Hora inexistente (salto de primavera): el reloj pasa directo a la hora siguiente.
  return new Date(pared - Math.min(...desfases));
}

/**
 * Último instante en que el cliente puede cancelar online: el inicio de la reserva menos
 * `TiempoCancelacionHoras` horas reales. Con 0 horas, se puede cancelar hasta el inicio.
 */
export function limiteCancelacion(
  fecha: string | Date,
  horaInicio: string | Date,
  horas: number,
): Date {
  const horasValidas = Number.isFinite(horas) && horas > 0 ? horas : 0;
  return new Date(
    inicioReserva(fecha, horaInicio).getTime() - horasValidas * HORA_MS,
  );
}
