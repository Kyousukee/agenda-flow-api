import { ConfigService } from '@nestjs/config';
import { ReservaCorreosService } from './reserva-correos.service';
import type { CorreoSaliente } from './correos.service';
import { hashToken } from '../auth/token-cuenta';

function montar(
  opciones: {
    fecha?: string;
    horaInicio?: string;
    config?: object | null;
    emailCliente?: string;
    emailEmpresa?: string;
    empleado?: object | null;
    estado?: string;
    update?: jest.Mock;
  } = {},
) {
  const reserva = {
    id: 5,
    codigo: 'ab12cd34-0000-0000-0000-000000000000',
    fecha: opciones.fecha ?? '2099-01-10',
    horaInicio: opciones.horaInicio ?? '10:00:00',
    horaFin: '10:30:00',
    precio: 15000,
    cliente: {
      nombre: 'Carlos',
      apellido: 'López',
      email: opciones.emailCliente ?? 'carlos@email.com',
    },
    empleado: opciones.empleado ?? null,
    servicio: { nombre: 'Corte', duracionMinutos: 30 },
    sucursal: { nombre: 'Casa Matriz' },
    empresa: {
      id: 1,
      nombre: 'Barbería',
      email: opciones.emailEmpresa ?? 'local@barberia.cl',
    },
    estado: { nombre: opciones.estado ?? 'Programada', color: '#3498db' },
  };
  const reservaRepo = {
    findOne: jest.fn().mockResolvedValue(reserva),
    update: opciones.update ?? jest.fn().mockResolvedValue(undefined),
  };
  const configRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        'config' in opciones
          ? opciones.config
          : { enviarCorreo: true, tiempoCancelacionHoras: 24 },
      ),
  };
  const correos = {
    enviar: jest.fn<Promise<boolean>, [CorreoSaliente]>(() =>
      Promise.resolve(true),
    ),
  };
  const config = {
    get: (nombre: string) =>
      nombre === 'FRONT_URL' ? 'https://app.agendaflow.cl/' : undefined,
  } as unknown as ConfigService;

  const service = new ReservaCorreosService(
    reservaRepo as never,
    configRepo as never,
    { findOne: jest.fn() } as never,
    correos as never,
    config,
  );
  const enviados = () => correos.enviar.mock.calls.map(([correo]) => correo);
  const correoAlCliente = () =>
    enviados().find((correo) => correo.to === 'carlos@email.com');
  return { service, reservaRepo, correos, correoAlCliente, enviados };
}

/** SPEC 07: token del enlace público de cancelación en la confirmación al cliente. */
describe('ReservaCorreosService.notificarNuevaReserva: enlace de cancelación', () => {
  it('genera un token, guarda solo su hash y pone el enlace en el correo', async () => {
    const { service, reservaRepo, correoAlCliente } = montar();

    await service.notificarNuevaReserva(5);

    expect(reservaRepo.update).toHaveBeenCalledTimes(1);
    const [id, { tokenCancelacionHash }] = reservaRepo.update.mock.calls[0] as [
      number,
      { tokenCancelacionHash: string },
    ];
    expect(id).toBe(5);
    expect(tokenCancelacionHash).toMatch(/^[0-9a-f]{64}$/);

    const correo = correoAlCliente()!;
    const token = /reserva\/cancelar\?token=([0-9a-f]+)/.exec(correo.text)?.[1];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token!)).toBe(tokenCancelacionHash);
    // El token en claro no es lo que se guarda.
    expect(token).not.toBe(tokenCancelacionHash);
    expect(correo.text).toContain(
      'https://app.agendaflow.cl/reserva/cancelar?token=',
    );
    expect(correo.html).toContain('Cancelar mi reserva');
    // 2099-01-10 10:00 en Chile (UTC-3) menos 24 h.
    expect(correo.text).toContain(
      'Puedes cancelar online hasta el viernes, 9 de enero de 2099 a las 10:00',
    );
  });

  it('cada envío genera un token nuevo (el anterior deja de servir)', async () => {
    const { service, reservaRepo } = montar();

    await service.notificarNuevaReserva(5);
    await service.notificarNuevaReserva(5);

    const [primero, segundo] = reservaRepo.update.mock.calls.map(
      ([, datos]) =>
        (datos as { tokenCancelacionHash: string }).tokenCancelacionHash,
    );
    expect(primero).not.toBe(segundo);
  });

  it('con el plazo vencido no genera token y el correo sale sin el botón', async () => {
    const { service, reservaRepo, correoAlCliente } = montar({
      fecha: '2020-01-10',
    });

    await service.notificarNuevaReserva(5);

    expect(reservaRepo.update).not.toHaveBeenCalled();
    expect(correoAlCliente()!.html).not.toContain('Cancelar mi reserva');
  });

  it('sin fila de configuración no envía al cliente ni genera token', async () => {
    // Sin ConfiguracionEmpresa, EnviarCorreo cuenta como false (SPEC 02).
    const { service, reservaRepo } = montar({ config: null });
    await service.notificarNuevaReserva(5);
    expect(reservaRepo.update).not.toHaveBeenCalled();
  });

  it('si la empresa no envía correos al cliente, no genera token', async () => {
    const { service, reservaRepo, correoAlCliente } = montar({
      config: { enviarCorreo: false, tiempoCancelacionHoras: 24 },
    });

    await service.notificarNuevaReserva(5);

    expect(reservaRepo.update).not.toHaveBeenCalled();
    expect(correoAlCliente()).toBeUndefined();
  });

  it('sin email del cliente no genera token', async () => {
    const { service, reservaRepo } = montar({ emailCliente: '  ' });
    await service.notificarNuevaReserva(5);
    expect(reservaRepo.update).not.toHaveBeenCalled();
  });

  it('si no se puede guardar el hash, el correo sale igual sin el botón', async () => {
    const { service, correoAlCliente } = montar({
      update: jest.fn().mockRejectedValue(new Error('BD caída')),
    });

    await service.notificarNuevaReserva(5);

    const correo = correoAlCliente()!;
    expect(correo.html).not.toContain('Cancelar mi reserva');
    expect(correo.text).toContain('Si necesitas cambiar o cancelar tu hora');
  });

  it('con TiempoCancelacionHoras = 0, el plazo es el inicio de la reserva', async () => {
    const { service, correoAlCliente } = montar({
      config: { enviarCorreo: true, tiempoCancelacionHoras: 0 },
    });

    await service.notificarNuevaReserva(5);

    expect(correoAlCliente()!.text).toContain(
      'Puedes cancelar online hasta el sábado, 10 de enero de 2099 a las 10:00',
    );
  });
});

describe('ReservaCorreosService: correos de cancelación y reembolso (SPEC 07)', () => {
  it('cancelación del cliente con reembolso: al cliente y aviso al local', async () => {
    const { service, enviados } = montar({ estado: 'Cancelada' });

    await service.notificarCancelacionCliente(5, 4323);

    const correos = enviados();
    expect(correos.map((c) => c.to)).toEqual([
      'carlos@email.com',
      'local@barberia.cl',
    ]);
    expect(correos[0].subject).toBe(
      'Reserva cancelada en Barbería – reembolso de $4.323',
    );
    // El cliente responde al local.
    expect(correos[0].replyTo).toBe('local@barberia.cl');
    expect(correos[1].subject).toBe(
      'Reserva de Carlos López cambió a Cancelada',
    );
  });

  it('cancelación sin reembolso: variante sin monto', async () => {
    const { service, correoAlCliente } = montar({ estado: 'Cancelada' });
    await service.notificarCancelacionCliente(5, null);
    expect(correoAlCliente()!.subject).toBe(
      'Tu reserva en Barbería fue cancelada',
    );
  });

  it('avisa también al empleado si su email es distinto al del local', async () => {
    const { service, enviados } = montar({
      estado: 'Cancelada',
      empleado: { id: 3, nombre: 'María', email: 'maria@barberia.cl' },
    });
    await service.notificarCancelacionCliente(5, null);
    expect(enviados().map((c) => c.to)).toContain('maria@barberia.cl');
  });

  it('reembolso desde el panel: solo al cliente', async () => {
    const { service, enviados } = montar();

    await service.notificarReembolso(5, 1000, false);

    const correos = enviados();
    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('carlos@email.com');
    expect(correos[0].subject).toBe('Reembolso de $1.000 de Barbería');
  });

  it('reembolso desde el panel: respeta EnviarCorreo de la empresa', async () => {
    const { service, enviados } = montar({
      config: { enviarCorreo: false, tiempoCancelacionHoras: 24 },
    });
    await service.notificarReembolso(5, 1000, true);
    expect(enviados()).toHaveLength(0);
  });

  it('reembolso rechazado: aviso al local con el enlace al panel de pagos', async () => {
    const { service, enviados } = montar();

    await service.notificarReembolsoRechazado(5, 4323, 'Flow informó rejected');

    const correos = enviados();
    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('local@barberia.cl');
    expect(correos[0].subject).toBe(
      'Flow rechazó un reembolso de $4.323 – Carlos López',
    );
    expect(correos[0].text).toContain('https://app.agendaflow.cl/admin/pagos');
  });

  it('reembolso rechazado: se avisa aunque la empresa no envíe correos al cliente', async () => {
    const { service, enviados } = montar({
      config: { enviarCorreo: false, tiempoCancelacionHoras: 24 },
    });
    await service.notificarReembolsoRechazado(5, 4323, null);
    expect(enviados().map((c) => c.to)).toEqual(['local@barberia.cl']);
  });

  it('los avisos nunca lanzan, aunque falle la carga de la reserva', async () => {
    const { service, reservaRepo } = montar();
    reservaRepo.findOne.mockRejectedValue(new Error('BD caída'));
    await expect(
      service.notificarCancelacionCliente(5, null),
    ).resolves.toBeUndefined();
    await expect(
      service.notificarReembolso(5, 1, false),
    ).resolves.toBeUndefined();
    await expect(
      service.notificarReembolsoRechazado(5, 1, null),
    ).resolves.toBeUndefined();
  });
});
