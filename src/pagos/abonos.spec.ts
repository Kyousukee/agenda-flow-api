import { FLOW_MONTO_MINIMO, calcularAbono } from './abonos';

const activo = (tipoAnticipo: string, montoAnticipo = 0) => ({
  permitePagoAnticipado: true,
  tipoAnticipo,
  montoAnticipo,
});

describe('calcularAbono', () => {
  describe('Monto', () => {
    it('cobra el monto fijo', () => {
      expect(calcularAbono(10000, activo('Monto', 3000))).toBe(3000);
    });

    it('nunca supera el precio del servicio', () => {
      expect(calcularAbono(10000, activo('Monto', 15000))).toBe(10000);
    });
  });

  describe('Porcentaje', () => {
    it('redondea hacia arriba a pesos enteros', () => {
      expect(calcularAbono(9990, activo('Porcentaje', 30))).toBe(2997);
      expect(calcularAbono(9995, activo('Porcentaje', 30))).toBe(2999); // 2998.5
      expect(calcularAbono(1001, activo('Porcentaje', 50))).toBe(501); // 500.5
    });

    it('100% es el precio completo', () => {
      expect(calcularAbono(12345, activo('Porcentaje', 100))).toBe(12345);
    });
  });

  describe('Completo', () => {
    it('cobra el precio e ignora MontoAnticipo', () => {
      expect(calcularAbono(10000, activo('Completo', 50))).toBe(10000);
    });

    it('acepta precios decimales y strings (columnas DECIMAL)', () => {
      expect(calcularAbono('10000.00', activo('Completo'))).toBe(10000);
      expect(calcularAbono(9990.4, activo('Completo'))).toBe(9991);
    });
  });

  describe('casos sin cobro', () => {
    it('un abono menor que el mínimo de Flow devuelve null', () => {
      expect(
        calcularAbono(10000, activo('Monto', FLOW_MONTO_MINIMO - 1)),
      ).toBeNull();
      expect(calcularAbono(1000, activo('Porcentaje', 10))).toBeNull(); // 100
    });

    it('el mínimo exacto sí se cobra', () => {
      expect(calcularAbono(10000, activo('Monto', FLOW_MONTO_MINIMO))).toBe(
        FLOW_MONTO_MINIMO,
      );
    });

    it('precio 0 devuelve null', () => {
      expect(calcularAbono(0, activo('Completo'))).toBeNull();
    });

    it('anticipo desactivado devuelve null', () => {
      expect(
        calcularAbono(10000, {
          permitePagoAnticipado: false,
          tipoAnticipo: 'Completo',
        }),
      ).toBeNull();
    });

    it('tipo no válido o ausente devuelve null', () => {
      expect(calcularAbono(10000, activo('monto', 3000))).toBeNull();
      expect(
        calcularAbono(10000, {
          permitePagoAnticipado: true,
          tipoAnticipo: null,
        }),
      ).toBeNull();
    });
  });
});
