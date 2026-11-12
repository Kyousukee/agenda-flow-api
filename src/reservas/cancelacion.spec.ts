import { inicioReserva, limiteCancelacion } from './cancelacion';

const iso = (fecha: Date) => fecha.toISOString();

describe('inicioReserva (America/Santiago)', () => {
  it('en horario de verano (UTC-3)', () => {
    expect(iso(inicioReserva('2026-12-10', '15:00:00'))).toBe(
      '2026-12-10T18:00:00.000Z',
    );
  });

  it('en horario de invierno (UTC-4)', () => {
    expect(iso(inicioReserva('2026-07-10', '15:00:00'))).toBe(
      '2026-07-10T19:00:00.000Z',
    );
  });

  it('acepta HH:mm, fracciones de segundo y Date (componentes UTC)', () => {
    const esperado = '2026-12-10T18:00:00.000Z';
    expect(iso(inicioReserva('2026-12-10', '15:00'))).toBe(esperado);
    expect(iso(inicioReserva('2026-12-10', '15:00:00.0000000'))).toBe(esperado);
    expect(
      iso(
        inicioReserva(
          new Date('2026-12-10T00:00:00Z'),
          new Date('1970-01-01T15:00:00Z'),
        ),
      ),
    ).toBe(esperado);
  });

  it('hora repetida al volver al horario de invierno: toma la primera', () => {
    // 2026-04-04 a las 24:00 el reloj vuelve a las 23:00: 23:30 ocurre dos veces.
    expect(iso(inicioReserva('2026-04-04', '23:30'))).toBe(
      '2026-04-05T02:30:00.000Z',
    );
  });

  it('hora inexistente al pasar al horario de verano: se corre hacia adelante', () => {
    // 2026-09-06 a las 00:00 el reloj salta a la 01:00: 00:30 no existe.
    expect(iso(inicioReserva('2026-09-06', '00:30'))).toBe(
      '2026-09-06T04:30:00.000Z',
    );
  });

  it('una fecha o una hora inválida lanza error', () => {
    expect(() => inicioReserva('10-12-2026', '15:00')).toThrow();
    expect(() => inicioReserva('2026-12-10', 'mediodía')).toThrow();
  });
});

describe('limiteCancelacion', () => {
  it('24 horas: el día anterior a la misma hora (criterio de aceptación)', () => {
    // 2026-12-09 15:00 hora de Chile = 18:00 UTC.
    expect(iso(limiteCancelacion('2026-12-10', '15:00', 24))).toBe(
      '2026-12-09T18:00:00.000Z',
    );
  });

  it('24 horas en horario de invierno', () => {
    expect(iso(limiteCancelacion('2026-07-10', '15:00', 24))).toBe(
      '2026-07-09T19:00:00.000Z',
    );
  });

  it('0 horas: el límite es el inicio de la reserva', () => {
    expect(iso(limiteCancelacion('2026-12-10', '15:00', 0))).toBe(
      iso(inicioReserva('2026-12-10', '15:00')),
    );
  });

  it('un valor negativo o inválido se trata como 0', () => {
    const inicio = iso(inicioReserva('2026-12-10', '15:00'));
    expect(iso(limiteCancelacion('2026-12-10', '15:00', -5))).toBe(inicio);
    expect(iso(limiteCancelacion('2026-12-10', '15:00', NaN))).toBe(inicio);
  });

  it('cuenta horas reales al cruzar el fin del horario de verano', () => {
    // Reserva 2026-04-05 10:00 (UTC-4) = 14:00 UTC. 24 h antes = 2026-04-04 14:00 UTC,
    // que en Chile son las 11:00 (todavía UTC-3).
    expect(iso(limiteCancelacion('2026-04-05', '10:00', 24))).toBe(
      '2026-04-04T14:00:00.000Z',
    );
  });

  it('cuenta horas reales al cruzar el inicio del horario de verano', () => {
    // Reserva 2026-09-06 10:00 (UTC-3) = 13:00 UTC. 24 h antes = 2026-09-05 13:00 UTC,
    // que en Chile son las 09:00 (todavía UTC-4).
    expect(iso(limiteCancelacion('2026-09-06', '10:00', 24))).toBe(
      '2026-09-05T13:00:00.000Z',
    );
  });

  it('plazos largos (48 h)', () => {
    expect(iso(limiteCancelacion('2026-12-10', '15:00', 48))).toBe(
      '2026-12-08T18:00:00.000Z',
    );
  });
});
