import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { FlowClient, FlowError, cadenaAFirmar, firmar } from './flow.client';

function configCon(valores: Record<string, string>): ConfigService {
  return {
    get: (nombre: string) => valores[nombre],
  } as unknown as ConfigService;
}

function respuestaJson(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('firma de Flow', () => {
  // Ejemplo de la documentación de Flow (developers.flow.cl/api → "Cómo firmar"):
  // apiKey=XXXX-XXXX-XXXX, currency=CLP, amount=5000 → "amount5000apiKeyXXXX-XXXX-XXXXcurrencyCLP".
  const ejemplo = { apiKey: 'XXXX-XXXX-XXXX', currency: 'CLP', amount: 5000 };

  it('la cadena a firmar coincide con el ejemplo de la documentación', () => {
    expect(cadenaAFirmar(ejemplo)).toBe(
      'amount5000apiKeyXXXX-XXXX-XXXXcurrencyCLP',
    );
  });

  it('la firma es el HMAC-SHA256 hex de esa cadena con la secretKey', () => {
    const esperado = createHmac('sha256', 'mi-secret')
      .update('amount5000apiKeyXXXX-XXXX-XXXXcurrencyCLP')
      .digest('hex');
    expect(firmar(ejemplo, 'mi-secret')).toBe(esperado);
    expect(firmar(ejemplo, 'mi-secret')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el parámetro s no entra en la firma', () => {
    expect(cadenaAFirmar({ ...ejemplo, s: 'abc' })).toBe(
      cadenaAFirmar(ejemplo),
    );
  });
});

describe('FlowClient', () => {
  const credenciales = { apiKey: 'API-KEY', secretKey: 'SECRET' };
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const cliente = () =>
    new FlowClient(
      configCon({
        FLOW_API_URL: 'https://sandbox.flow.cl/api/',
        FLOW_API_KEY: 'PROPIA',
        FLOW_SECRET_KEY: 'PROPIA-SECRET',
        API_PUBLIC_URL: 'https://api.ejemplo.cl/',
      }),
    );

  it('crearPago envía el formulario firmado y arma la URL de pago', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson(200, {
        url: 'https://sandbox.flow.cl/app/web/pay.php',
        token: 'TOK',
        flowOrder: 123,
      }),
    );

    const pago = await cliente().crearPago(credenciales, {
      commerceOrder: 'R-1',
      subject: 'Abono',
      amount: 5000,
      email: 'cliente@ejemplo.cl',
      urlConfirmation: 'https://api.ejemplo.cl/flow/abono/confirmacion',
      urlReturn: 'https://api.ejemplo.cl/flow/abono/retorno',
      timeout: 900,
    });

    expect(pago).toEqual({
      url: 'https://sandbox.flow.cl/app/web/pay.php',
      token: 'TOK',
      flowOrder: 123,
      urlPago: 'https://sandbox.flow.cl/app/web/pay.php?token=TOK',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.flow.cl/api/payment/create');
    expect(init.method).toBe('POST');
    const cuerpo = new URLSearchParams(init.body as string);
    expect(cuerpo.get('currency')).toBe('CLP');
    expect(cuerpo.get('timeout')).toBe('900');
    const sinFirma = Object.fromEntries(
      [...cuerpo.entries()].filter(([k]) => k !== 's'),
    );
    expect(cuerpo.get('s')).toBe(firmar(sinFirma, 'SECRET'));
  });

  it('obtenerEstado firma la query y normaliza la respuesta', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson(200, {
        status: 2,
        amount: '5000',
        commerceOrder: 'R-1',
        flowOrder: 123,
        paymentData: { date: '2026-11-10 12:00:00' },
      }),
    );

    const estado = await cliente().obtenerEstado(credenciales, 'TOK');

    expect(estado).toEqual({
      status: 2,
      amount: 5000,
      commerceOrder: 'R-1',
      flowOrder: 123,
      paymentData: { date: '2026-11-10 12:00:00' },
    });
    const [urlLlamada] = fetchMock.mock.calls[0] as [string];
    const url = new URL(urlLlamada);
    expect(url.pathname).toBe('/api/payment/getStatus');
    expect(url.searchParams.get('s')).toBe(
      firmar({ apiKey: 'API-KEY', token: 'TOK' }, 'SECRET'),
    );
  });

  it('un error HTTP de Flow lanza FlowError con el código y el mensaje', async () => {
    fetchMock.mockResolvedValue(
      respuestaJson(401, { code: 108, message: 'Invalid signature' }),
    );

    await expect(
      cliente().obtenerEstado(credenciales, 'TOK'),
    ).rejects.toMatchObject({
      name: 'FlowError',
      httpStatus: 401,
      codigo: 108,
    });
  });

  it('un fallo de red lanza FlowError', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      cliente().obtenerEstado(credenciales, 'TOK'),
    ).rejects.toBeInstanceOf(FlowError);
  });

  it('expone las credenciales propias y la URL pública sin barras duplicadas', () => {
    const c = cliente();
    expect(c.credencialesAgendaFlow).toEqual({
      apiKey: 'PROPIA',
      secretKey: 'PROPIA-SECRET',
    });
    expect(c.urlPublica('/flow/abono/retorno')).toBe(
      'https://api.ejemplo.cl/flow/abono/retorno',
    );
  });

  it('sin FLOW_API_KEY no hay credenciales propias', () => {
    expect(new FlowClient(configCon({})).credencialesAgendaFlow).toBeNull();
  });
});
