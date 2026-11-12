import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SPEC 06: cliente HTTP de Flow (payment/create y payment/getStatus).
 * Cada llamada se firma con las credenciales del comercio que recibe el dinero:
 * la cuenta de AgendaFlow (mensualidad) o la del local (abonos).
 */

const FLOW_API_URL_POR_DEFECTO = 'https://sandbox.flow.cl/api';
const API_PUBLIC_URL_POR_DEFECTO = 'http://localhost:3000';
const TIMEOUT_HTTP_MS = 15_000;

/** Valores de `status` en payment/getStatus. */
export const ESTADO_FLOW = {
  PENDIENTE: 1,
  PAGADA: 2,
  RECHAZADA: 3,
  ANULADA: 4,
} as const;

export interface CredencialesFlow {
  apiKey: string;
  secretKey: string;
}

export interface DatosPagoFlow {
  commerceOrder: string;
  subject: string;
  /** Pesos enteros (CLP). */
  amount: number;
  email: string;
  urlConfirmation: string;
  urlReturn: string;
  /** Segundos hasta que el link de pago expira. */
  timeout?: number;
}

export interface PagoCreadoFlow {
  url: string;
  token: string;
  flowOrder: number;
  /** URL a la que se envía el navegador: `${url}?token=${token}`. */
  urlPago: string;
}

export interface EstadoPagoFlow {
  status: number;
  amount: number;
  commerceOrder: string;
  flowOrder: number;
  paymentData?: { date?: string | null } | null;
}

export class FlowError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly codigo?: number,
  ) {
    super(message);
    this.name = 'FlowError';
  }
}

type Parametros = Record<string, string | number>;

/** Nombres en orden alfabético, cada uno seguido de su valor, sin separadores. `s` no se firma. */
export function cadenaAFirmar(params: Parametros): string {
  return Object.keys(params)
    .filter((nombre) => nombre !== 's')
    .sort()
    .map((nombre) => `${nombre}${params[nombre]}`)
    .join('');
}

/** HMAC-SHA256 de la cadena con la secretKey, en hex. */
export function firmar(params: Parametros, secretKey: string): string {
  return createHmac('sha256', secretKey)
    .update(cadenaAFirmar(params))
    .digest('hex');
}

@Injectable()
export class FlowClient {
  private readonly logger = new Logger(FlowClient.name);
  private readonly apiUrl: string;
  private readonly apiPublicUrl: string;
  private readonly propias: CredencialesFlow | null;

  constructor(config: ConfigService) {
    this.apiUrl = (
      config.get<string>('FLOW_API_URL')?.trim() || FLOW_API_URL_POR_DEFECTO
    ).replace(/\/+$/, '');
    this.apiPublicUrl = (
      config.get<string>('API_PUBLIC_URL')?.trim() || API_PUBLIC_URL_POR_DEFECTO
    ).replace(/\/+$/, '');

    const apiKey = config.get<string>('FLOW_API_KEY')?.trim();
    const secretKey = config.get<string>('FLOW_SECRET_KEY')?.trim();
    this.propias = apiKey && secretKey ? { apiKey, secretKey } : null;
    if (!this.propias) {
      this.logger.warn(
        'FLOW_API_KEY o FLOW_SECRET_KEY no están configuradas: el pago de la mensualidad queda desactivado',
      );
    }
  }

  /** Cuenta Flow de AgendaFlow, que recibe la mensualidad. */
  get credencialesAgendaFlow(): CredencialesFlow | null {
    return this.propias;
  }

  /** URL pública de esta API, para urlConfirmation y urlReturn. */
  urlPublica(ruta: string): string {
    return `${this.apiPublicUrl}/${ruta.replace(/^\/+/, '')}`;
  }

  async crearPago(
    credenciales: CredencialesFlow,
    datos: DatosPagoFlow,
  ): Promise<PagoCreadoFlow> {
    const params: Parametros = {
      apiKey: credenciales.apiKey,
      commerceOrder: datos.commerceOrder,
      subject: datos.subject,
      currency: 'CLP',
      amount: datos.amount,
      email: datos.email,
      urlConfirmation: datos.urlConfirmation,
      urlReturn: datos.urlReturn,
    };
    if (datos.timeout) {
      params.timeout = datos.timeout;
    }
    const cuerpo = this.conFirma(params, credenciales.secretKey);

    const respuesta = await this.llamar(`${this.apiUrl}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    const { url, token, flowOrder } = respuesta as {
      url?: string;
      token?: string;
      flowOrder?: number;
    };
    if (!url || !token) {
      throw new FlowError('Flow no devolvió url y token');
    }
    return {
      url,
      token,
      flowOrder: Number(flowOrder),
      urlPago: `${url}?token=${token}`,
    };
  }

  async obtenerEstado(
    credenciales: CredencialesFlow,
    token: string,
  ): Promise<EstadoPagoFlow> {
    const query = this.conFirma(
      { apiKey: credenciales.apiKey, token },
      credenciales.secretKey,
    );
    const respuesta = (await this.llamar(
      `${this.apiUrl}/payment/getStatus?${query.toString()}`,
      {
        method: 'GET',
      },
    )) as Partial<EstadoPagoFlow>;
    return {
      status: Number(respuesta.status),
      amount: Number(respuesta.amount),
      commerceOrder: String(respuesta.commerceOrder ?? ''),
      flowOrder: Number(respuesta.flowOrder),
      paymentData: respuesta.paymentData ?? null,
    };
  }

  private conFirma(params: Parametros, secretKey: string): URLSearchParams {
    const firmados = new URLSearchParams();
    for (const [nombre, valor] of Object.entries(params)) {
      firmados.append(nombre, String(valor));
    }
    firmados.append('s', firmar(params, secretKey));
    return firmados;
  }

  private async llamar(url: string, init: RequestInit): Promise<unknown> {
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_HTTP_MS),
      });
    } catch (error) {
      throw new FlowError(
        `No se pudo conectar con Flow: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const texto = await respuesta.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      // Flow respondió algo que no es JSON; se informa abajo si además es un error.
    }

    if (!respuesta.ok) {
      const { code, message } = (cuerpo ?? {}) as {
        code?: number;
        message?: string;
      };
      throw new FlowError(
        `Flow respondió ${respuesta.status}: ${message ?? texto.slice(0, 200)}`,
        respuesta.status,
        code,
      );
    }
    if (cuerpo === null) {
      throw new FlowError(
        'Flow respondió un cuerpo vacío o inválido',
        respuesta.status,
      );
    }
    return cuerpo;
  }
}
