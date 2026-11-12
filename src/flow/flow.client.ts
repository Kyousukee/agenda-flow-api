import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SPEC 06: cliente HTTP de Flow (payment/create y payment/getStatus).
 * SPEC 07: refund/create y refund/getStatus.
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
  paymentData?: DatosDelPagoFlow | null;
}

/** `paymentData` de payment/getStatus. Flow puede enviar los montos como texto. */
export interface DatosDelPagoFlow {
  date?: string | null;
  amount?: number | string | null;
  fee?: number | string | null;
  taxes?: number | string | null;
  /** Lo que se transfiere al comercio: amount − fee − taxes. */
  balance?: number | string | null;
}

/**
 * SPEC 07: monto neto que recibe el comercio (`paymentData.balance`), en pesos enteros.
 * Devuelve null si Flow no lo informa o no es un número válido.
 */
export function montoNetoDeFlow(
  paymentData: DatosDelPagoFlow | null | undefined,
): number | null {
  const valor = paymentData?.balance;
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }
  const neto = Number(valor);
  return Number.isFinite(neto) && neto >= 0 ? Math.floor(neto) : null;
}

/**
 * SPEC 07: valores de `status` en refund/create y refund/getStatus.
 * Confirmar en el sandbox (paso 10 del plan).
 */
export const ESTADO_REEMBOLSO_FLOW = {
  CREADO: 'created',
  ACEPTADO: 'accepted',
  RECHAZADO: 'rejected',
  REEMBOLSADO: 'refunded',
  CANCELADO: 'canceled',
} as const;

export interface DatosReembolsoFlow {
  /** Orden propia del reembolso: `RF-{Reembolso.Id}`. */
  refundCommerceOrder: string;
  /** Email de quien recibe la devolución (el cliente que pagó). */
  receiverEmail: string;
  /** Pesos enteros (CLP). */
  amount: number;
  urlCallBack: string;
  /** commerceOrder del cobro original: `R-{Pago.Id}`. */
  commerceTrxId: string;
}

export interface ReembolsoFlow {
  token: string;
  flowRefundOrder: number;
  status: string;
  amount: number;
  /** Comisión de Flow por el reembolso, si la informa. */
  fee: number | null;
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

  /** SPEC 07: pide a Flow devolver parte o todo un cobro. Es asíncrono: el resultado llega a urlCallBack. */
  async crearReembolso(
    credenciales: CredencialesFlow,
    datos: DatosReembolsoFlow,
  ): Promise<ReembolsoFlow> {
    const cuerpo = this.conFirma(
      {
        apiKey: credenciales.apiKey,
        refundCommerceOrder: datos.refundCommerceOrder,
        receiverEmail: datos.receiverEmail,
        amount: datos.amount,
        urlCallBack: datos.urlCallBack,
        commerceTrxId: datos.commerceTrxId,
      },
      credenciales.secretKey,
    );

    const respuesta = await this.llamar(`${this.apiUrl}/refund/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    });
    const reembolso = this.normalizarReembolso(respuesta);
    if (!reembolso.token) {
      throw new FlowError('Flow no devolvió el token del reembolso');
    }
    return reembolso;
  }

  async estadoReembolso(
    credenciales: CredencialesFlow,
    token: string,
  ): Promise<ReembolsoFlow> {
    const query = this.conFirma(
      { apiKey: credenciales.apiKey, token },
      credenciales.secretKey,
    );
    const respuesta = await this.llamar(
      `${this.apiUrl}/refund/getStatus?${query.toString()}`,
      { method: 'GET' },
    );
    const reembolso = this.normalizarReembolso(respuesta);
    return { ...reembolso, token: reembolso.token || token };
  }

  private normalizarReembolso(respuesta: unknown): ReembolsoFlow {
    const r = respuesta as Partial<
      Record<keyof ReembolsoFlow, string | number | null>
    >;
    const fee =
      r.fee === undefined || r.fee === null || r.fee === ''
        ? null
        : Number(r.fee);
    return {
      token: String(r.token ?? ''),
      flowRefundOrder: Number(r.flowRefundOrder),
      status: String(r.status ?? '').toLowerCase(),
      amount: Number(r.amount),
      fee: fee !== null && Number.isFinite(fee) ? fee : null,
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
