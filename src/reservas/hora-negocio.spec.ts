import { ahoraEnNegocio, horaDeMinutos, minutosDeHora } from './hora-negocio';

describe('ahoraEnNegocio', () => {
  it('convierte a hora de Chile en horario de verano (UTC-3)', () => {
    expect(ahoraEnNegocio(new Date('2026-12-10T18:30:00Z'))).toEqual({
      fecha: '2026-12-10',
      minutos: 15 * 60 + 30,
    });
  });

  it('convierte a hora de Chile en horario de invierno (UTC-4)', () => {
    expect(ahoraEnNegocio(new Date('2026-07-10T18:30:00Z'))).toEqual({
      fecha: '2026-07-10',
      minutos: 14 * 60 + 30,
    });
  });

  it('cerca de medianoche, en UTC ya es mañana pero en Chile sigue siendo hoy', () => {
    expect(ahoraEnNegocio(new Date('2026-11-14T02:30:00Z'))).toEqual({
      fecha: '2026-11-13',
      minutos: 23 * 60 + 30,
    });
  });

  it('pasada la medianoche de Chile cambia la fecha', () => {
    expect(ahoraEnNegocio(new Date('2026-11-14T03:10:00Z'))).toEqual({
      fecha: '2026-11-14',
      minutos: 10,
    });
  });
});

describe('minutosDeHora y horaDeMinutos', () => {
  it('lee "HH:mm" y "HH:mm:ss.fff"', () => {
    expect(minutosDeHora('09:30')).toBe(570);
    expect(minutosDeHora('09:30:00.0000000')).toBe(570);
  });

  it('lee un Date del driver por sus componentes UTC', () => {
    expect(minutosDeHora(new Date('1970-01-01T16:45:00Z'))).toBe(16 * 60 + 45);
  });

  it('formatea minutos como HH:mm', () => {
    expect(horaDeMinutos(570)).toBe('09:30');
    expect(horaDeMinutos(0)).toBe('00:00');
  });
});
