import { createHash, randomBytes } from 'node:crypto';

const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;

/** Vigencia de los enlaces que se envían por correo. */
export const VIGENCIA_VERIFICACION_MS = 24 * HORA_MS;
export const VIGENCIA_RESET_MS = HORA_MS;
/** SPEC 08: la invitación de un recepcionista usa las columnas de reset, con más plazo. */
export const VIGENCIA_INVITACION_MS = 7 * 24 * HORA_MS;

/** Límite de correos por usuario y tipo. */
export const ESPERA_ENTRE_ENVIOS_MS = MINUTO_MS;
export const VENTANA_ENVIOS_MS = HORA_MS;
export const MAX_ENVIOS_POR_VENTANA = 5;

export interface TokenCuenta {
  /** Solo viaja en el correo; nunca se guarda ni se escribe en el log. */
  token: string;
  /** SHA-256 en hexadecimal: es lo único que se guarda. */
  hash: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generarToken(): TokenCuenta {
  const token = randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

export interface EstadoEnvios {
  ultimoEnvio: Date | null;
  ventanaInicio: Date | null;
  enviosVentana: number;
}

export type EvaluacionEnvio =
  | { permitido: false }
  | { permitido: true; ventanaInicio: Date; enviosVentana: number };

/**
 * Decide si se puede enviar otro correo de un tipo y, si se puede, devuelve los
 * valores de la ventana que hay que guardar junto con el envío.
 */
export function evaluarLimiteEnvio(
  estado: EstadoEnvios,
  ahora: Date,
): EvaluacionEnvio {
  const { ultimoEnvio, ventanaInicio, enviosVentana } = estado;

  if (
    ultimoEnvio &&
    ahora.getTime() - ultimoEnvio.getTime() < ESPERA_ENTRE_ENVIOS_MS
  ) {
    return { permitido: false };
  }

  const ventanaVencida =
    !ventanaInicio ||
    ahora.getTime() - ventanaInicio.getTime() > VENTANA_ENVIOS_MS;
  if (ventanaVencida) {
    return { permitido: true, ventanaInicio: ahora, enviosVentana: 1 };
  }

  if (enviosVentana >= MAX_ENVIOS_POR_VENTANA) {
    return { permitido: false };
  }

  return {
    permitido: true,
    ventanaInicio,
    enviosVentana: enviosVentana + 1,
  };
}
