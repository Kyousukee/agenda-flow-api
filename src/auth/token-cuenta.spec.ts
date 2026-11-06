import {
  ESPERA_ENTRE_ENVIOS_MS,
  MAX_ENVIOS_POR_VENTANA,
  VENTANA_ENVIOS_MS,
  evaluarLimiteEnvio,
  generarToken,
  hashToken,
} from './token-cuenta';

describe('token-cuenta', () => {
  describe('tokens', () => {
    it('el hash es determinista', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'));
      expect(hashToken('abc')).not.toBe(hashToken('abd'));
    });

    it('el hash es SHA-256 en hexadecimal (cabe en NVARCHAR(64))', () => {
      expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('el token no se repite y el hash corresponde al token', () => {
      const a = generarToken();
      const b = generarToken();
      expect(a.token).not.toBe(b.token);
      expect(a.token).toMatch(/^[0-9a-f]{64}$/);
      expect(a.hash).toBe(hashToken(a.token));
      expect(a.hash).not.toBe(a.token);
    });
  });

  describe('evaluarLimiteEnvio', () => {
    const ahora = new Date('2026-11-06T12:00:00.000Z');
    const hace = (ms: number) => new Date(ahora.getTime() - ms);

    it('permite el primer envío y abre la ventana', () => {
      expect(
        evaluarLimiteEnvio(
          { ultimoEnvio: null, ventanaInicio: null, enviosVentana: 0 },
          ahora,
        ),
      ).toEqual({ permitido: true, ventanaInicio: ahora, enviosVentana: 1 });
    });

    it('rechaza si pasó menos de 1 minuto desde el último envío', () => {
      expect(
        evaluarLimiteEnvio(
          {
            ultimoEnvio: hace(ESPERA_ENTRE_ENVIOS_MS - 1),
            ventanaInicio: hace(ESPERA_ENTRE_ENVIOS_MS - 1),
            enviosVentana: 1,
          },
          ahora,
        ),
      ).toEqual({ permitido: false });
    });

    it('permite justo al cumplirse el minuto y suma a la ventana', () => {
      const inicio = hace(ESPERA_ENTRE_ENVIOS_MS);
      expect(
        evaluarLimiteEnvio(
          { ultimoEnvio: inicio, ventanaInicio: inicio, enviosVentana: 1 },
          ahora,
        ),
      ).toEqual({ permitido: true, ventanaInicio: inicio, enviosVentana: 2 });
    });

    it('permite el quinto envío de la ventana y rechaza el sexto', () => {
      const inicio = hace(30 * 60 * 1000);
      const ultimoEnvio = hace(ESPERA_ENTRE_ENVIOS_MS);

      expect(
        evaluarLimiteEnvio(
          {
            ultimoEnvio,
            ventanaInicio: inicio,
            enviosVentana: MAX_ENVIOS_POR_VENTANA - 1,
          },
          ahora,
        ),
      ).toEqual({
        permitido: true,
        ventanaInicio: inicio,
        enviosVentana: MAX_ENVIOS_POR_VENTANA,
      });

      expect(
        evaluarLimiteEnvio(
          {
            ultimoEnvio,
            ventanaInicio: inicio,
            enviosVentana: MAX_ENVIOS_POR_VENTANA,
          },
          ahora,
        ),
      ).toEqual({ permitido: false });
    });

    it('reinicia la ventana cuando pasó más de 1 hora', () => {
      expect(
        evaluarLimiteEnvio(
          {
            ultimoEnvio: hace(VENTANA_ENVIOS_MS),
            ventanaInicio: hace(VENTANA_ENVIOS_MS + 1),
            enviosVentana: MAX_ENVIOS_POR_VENTANA,
          },
          ahora,
        ),
      ).toEqual({ permitido: true, ventanaInicio: ahora, enviosVentana: 1 });
    });

    it('mantiene la ventana si pasó exactamente 1 hora', () => {
      expect(
        evaluarLimiteEnvio(
          {
            ultimoEnvio: hace(VENTANA_ENVIOS_MS),
            ventanaInicio: hace(VENTANA_ENVIOS_MS),
            enviosVentana: MAX_ENVIOS_POR_VENTANA,
          },
          ahora,
        ),
      ).toEqual({ permitido: false });
    });
  });
});
