import { ConfigService } from '@nestjs/config';
import { CorreoSaliente, CorreosService } from './correos.service';
import { CuentaCorreosService } from './cuenta-correos.service';

describe('CuentaCorreosService', () => {
  const destinatario = { nombre: 'Ana', email: 'ana@correo.cl' };

  function crear(frontUrl?: string) {
    const enviar = jest.fn<Promise<boolean>, [CorreoSaliente]>(() =>
      Promise.resolve(true),
    );
    const servicio = new CuentaCorreosService(
      { enviar } as unknown as CorreosService,
      { get: () => frontUrl } as unknown as ConfigService,
    );
    return { servicio, correo: () => enviar.mock.calls[0][0] };
  }

  it('arma el enlace de verificación con FRONT_URL', async () => {
    const { servicio, correo } = crear('https://agendaflow.cl');
    await servicio.enviarVerificacion(destinatario, 'tok123');
    expect(correo().text).toContain(
      'https://agendaflow.cl/verificar-email?token=tok123',
    );
  });

  it('arma el enlace de restablecimiento con FRONT_URL', async () => {
    const { servicio, correo } = crear('https://agendaflow.cl');
    await servicio.enviarRestablecimiento(destinatario, 'tok123');
    expect(correo().text).toContain(
      'https://agendaflow.cl/restablecer-contrasena?token=tok123',
    );
  });

  it('tolera una barra final en FRONT_URL', async () => {
    const { servicio, correo } = crear('https://agendaflow.cl/');
    await servicio.enviarVerificacion(destinatario, 'tok123');
    expect(correo().text).toContain(
      'https://agendaflow.cl/verificar-email?token=tok123',
    );
  });

  it('usa localhost si falta FRONT_URL', async () => {
    const { servicio, correo } = crear(undefined);
    await servicio.enviarVerificacion(destinatario, 'tok123');
    expect(correo().text).toContain(
      'http://localhost:4200/verificar-email?token=tok123',
    );
  });

  it('envía al usuario con la marca AgendaFlow y sin reply-to', async () => {
    const { servicio, correo } = crear('https://agendaflow.cl');
    await servicio.enviarRestablecimiento(destinatario, 'tok123');
    expect(correo().to).toBe('ana@correo.cl');
    expect(correo().fromName).toBe('AgendaFlow');
    expect(correo().replyTo).toBeUndefined();
  });

  it('SPEC 08: arma el enlace de invitación con FRONT_URL', async () => {
    const { servicio, correo } = crear('https://agendaflow.cl');
    await servicio.enviarInvitacion(destinatario, 'tok123', {
      empresa: 'Barbería',
      sucursal: 'Centro',
      invitadoPor: 'José',
    });
    expect(correo().to).toBe('ana@correo.cl');
    expect(correo().text).toContain(
      'https://agendaflow.cl/invitacion?token=tok123',
    );
  });
});
