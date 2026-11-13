import { primerHueco, redondearAbajo, redondearArriba } from './huecos';

const h = (hora: string) => {
  const [hh, mm] = hora.split(':').map(Number);
  return hh * 60 + mm;
};
const tramo = (inicio: string, fin: string) => ({
  inicio: h(inicio),
  fin: h(fin),
});

describe('primerHueco', () => {
  const abiertos = [tramo('10:00', '20:00')];

  it('devuelve el inicio del horario si el día está libre', () => {
    expect(
      primerHueco({ desde: 0, duracion: 30, abiertos, ocupados: [] }),
    ).toBe(h('10:00'));
  });

  it('encuentra el hueco entre dos reservas si cabe el servicio', () => {
    const ocupados = [tramo('10:00', '10:30'), tramo('10:45', '11:30')];
    expect(
      primerHueco({ desde: h('10:05'), duracion: 15, abiertos, ocupados }),
    ).toBe(h('10:30'));
  });

  it('salta el hueco que no alcanza (criterio de aceptación)', () => {
    const ocupados = [tramo('10:00', '10:30'), tramo('10:45', '11:30')];
    expect(
      primerHueco({ desde: h('10:05'), duracion: 30, abiertos, ocupados }),
    ).toBe(h('11:30'));
  });

  it('no usa un hueco al que le faltan 5 minutos', () => {
    const ocupados = [tramo('10:00', '10:30'), tramo('10:55', '12:00')];
    expect(
      primerHueco({ desde: h('10:00'), duracion: 30, abiertos, ocupados }),
    ).toBe(h('12:00'));
  });

  it('respeta los bloqueos como ocupados', () => {
    const ocupados = [tramo('13:00', '15:00')];
    expect(
      primerHueco({ desde: h('12:45'), duracion: 30, abiertos, ocupados }),
    ).toBe(h('15:00'));
  });

  it('usa la tarde de un horario partido', () => {
    const partido = [tramo('10:00', '13:00'), tramo('15:00', '19:00')];
    expect(
      primerHueco({
        desde: h('12:45'),
        duracion: 30,
        abiertos: partido,
        ocupados: [],
      }),
    ).toBe(h('15:00'));
  });

  it('empieza desde "ahora" dentro del horario', () => {
    expect(
      primerHueco({ desde: h('16:35'), duracion: 30, abiertos, ocupados: [] }),
    ).toBe(h('16:35'));
  });

  it('devuelve null si no queda cupo en el día', () => {
    expect(
      primerHueco({ desde: h('19:45'), duracion: 30, abiertos, ocupados: [] }),
    ).toBeNull();
    expect(
      primerHueco({
        desde: h('10:00'),
        duracion: 30,
        abiertos,
        ocupados: [tramo('10:00', '20:00')],
      }),
    ).toBeNull();
  });

  it('devuelve null sin horario abierto', () => {
    expect(
      primerHueco({ desde: 0, duracion: 30, abiertos: [], ocupados: [] }),
    ).toBeNull();
  });
});

describe('redondeo a 5 minutos', () => {
  it('redondea hacia arriba', () => {
    expect(redondearArriba(h('10:01'))).toBe(h('10:05'));
    expect(redondearArriba(h('10:05'))).toBe(h('10:05'));
  });

  it('redondea hacia abajo', () => {
    expect(redondearAbajo(h('10:04'))).toBe(h('10:00'));
  });
});
