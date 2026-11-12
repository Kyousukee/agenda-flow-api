import {
  formatearFecha,
  formatearHora,
  formatearInstante,
  formatearPrecio,
} from './formato';
import {
  COLOR_POR_DEFECTO,
  DatosReservaCorreo,
  MarcaEmpresa,
  colorValido,
  escapeHtml,
} from './layout';
import { reservaConfirmadaCliente } from './reserva-confirmada-cliente';
import { reservaNuevaInterna } from './reserva-nueva-interna';
import { estadoReservaCliente } from './estado-reserva-cliente';
import { estadoReservaEmpleado } from './estado-reserva-empleado';
import { textoEstado } from './textos-estado';
import { verificarEmail } from './verificar-email';
import { restablecerContrasena } from './restablecer-contrasena';
import { cancelacionCliente } from './cancelacion-cliente';
import { reembolsoRechazadoInterno } from './reembolso-rechazado-interno';

const marca: MarcaEmpresa = {
  nombre: 'Barbería Central',
  logoUrl: null,
  colorPrincipal: '#0f766e',
  telefono: '+56 9 1234 5678',
  email: 'contacto@barberia.cl',
};

const datosBase: DatosReservaCorreo = {
  codigo: 'AB12CD34',
  clienteNombre: 'Carlos López',
  clienteEmail: 'carlos@email.com',
  clienteTelefono: '977777777',
  servicio: 'Corte de cabello',
  duracionMinutos: 30,
  empleado: 'María García',
  sucursal: 'Casa Matriz',
  direccion: 'Av. Siempre Viva 123, Providencia, Santiago',
  fecha: 'jueves, 12 de noviembre de 2026',
  fechaCorta: 'jue, 12 nov',
  hora: '10:00 – 10:30',
  horaInicio: '10:00',
  precio: '$15.000',
  observacion: null,
  estado: { nombre: 'Programada', color: '#3498db' },
};

const plantillas = [
  ['reservaConfirmadaCliente', reservaConfirmadaCliente],
  ['reservaNuevaInterna', reservaNuevaInterna],
  ['estadoReservaCliente', estadoReservaCliente],
  ['estadoReservaEmpleado', estadoReservaEmpleado],
] as const;

describe('formato', () => {
  it('formatea una fecha string sin correrse de día', () => {
    expect(formatearFecha('2026-11-12')).toBe(
      'jueves, 12 de noviembre de 2026',
    );
  });

  it('formatea una fecha Date (medianoche UTC, como la devuelve mssql)', () => {
    expect(formatearFecha(new Date('2026-11-12T00:00:00.000Z'))).toBe(
      'jueves, 12 de noviembre de 2026',
    );
  });

  it('formatea una hora string con o sin segundos', () => {
    expect(formatearHora('10:00:00')).toBe('10:00');
    expect(formatearHora('9:05')).toBe('09:05');
  });

  it('formatea una hora Date (time de mssql = 1970-01-01 en UTC)', () => {
    expect(formatearHora(new Date('1970-01-01T14:30:00.000Z'))).toBe('14:30');
  });

  it('formatea el precio en CLP sin decimales', () => {
    expect(formatearPrecio(15000)).toBe('$15.000');
    expect(formatearPrecio('15000.00')).toBe('$15.000');
  });
});

describe('layout', () => {
  it('escapa HTML', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe(
      '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;',
    );
  });

  it('usa el color por defecto si el color no es un #hex válido', () => {
    expect(colorValido(null)).toBe(COLOR_POR_DEFECTO);
    expect(colorValido('rojo')).toBe(COLOR_POR_DEFECTO);
    expect(colorValido('#abc')).toBe('#abc');
  });
});

describe.each(plantillas)('%s', (_nombre, plantilla) => {
  it('escapa los datos dinámicos (no inyecta HTML)', () => {
    const { html } = plantilla(marca, {
      ...datosBase,
      clienteNombre: '<script>alert(1)</script><b>x</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('muestra el precio cuando viene', () => {
    const { html, text } = plantilla(marca, datosBase);
    expect(html).toContain('$15.000');
    expect(text).toContain('Precio: $15.000');
  });

  it('omite la fila de precio cuando precio = null', () => {
    const { html, text } = plantilla(marca, { ...datosBase, precio: null });
    expect(html).not.toContain('Precio');
    expect(text).not.toContain('Precio');
  });

  it('usa el logo si existe y el nombre en texto si no', () => {
    const conLogo = plantilla(
      { ...marca, logoUrl: 'https://res.cloudinary.com/x/logo.png' },
      datosBase,
    );
    expect(conLogo.html).toContain(
      '<img src="https://res.cloudinary.com/x/logo.png"',
    );
    const sinLogo = plantilla(marca, datosBase);
    expect(sinLogo.html).not.toContain('<img');
    expect(sinLogo.html).toContain('Barbería Central');
  });

  it('pinta el encabezado con el color principal', () => {
    expect(plantilla(marca, datosBase).html).toContain(
      'background-color:#0f766e',
    );
  });
});

describe('asuntos', () => {
  it('confirmación al cliente', () => {
    expect(reservaConfirmadaCliente(marca, datosBase).subject).toBe(
      'Reserva confirmada en Barbería Central – jue, 12 nov 10:00',
    );
  });

  it('aviso interno', () => {
    expect(reservaNuevaInterna(marca, datosBase).subject).toBe(
      'Nueva reserva: Carlos López – Corte de cabello – jue, 12 nov 10:00',
    );
  });

  it('cambio de estado al cliente concuerda el adjetivo', () => {
    const datos = { ...datosBase, estado: { nombre: 'Pagado', color: null } };
    expect(estadoReservaCliente(marca, datos).subject).toBe(
      'Tu reserva en Barbería Central está pagada',
    );
  });

  it('cambio de estado al empleado', () => {
    const datos = {
      ...datosBase,
      estado: { nombre: 'Cancelada', color: '#e74c3c' },
    };
    expect(estadoReservaEmpleado(marca, datos, 'María').subject).toBe(
      'Reserva de Carlos López cambió a Cancelada',
    );
  });
});

describe('textos-estado', () => {
  it('tiene texto para cada estado de reserva del seed', () => {
    for (const nombre of [
      'Programada',
      'Completada',
      'Pagado',
      'Pendiente',
      'Cancelada',
      'Rechazado',
      'Anulado',
    ]) {
      expect(textoEstado(nombre).titulo).not.toContain('cambió a');
    }
  });

  it('devuelve un texto genérico para un estado desconocido', () => {
    expect(textoEstado('En espera').titulo).toBe(
      'Tu reserva cambió a "En espera"',
    );
  });
});

describe('correos de cuenta', () => {
  const enlace = 'https://agendaflow.cl/ruta?token=abc123&x=1';
  const plantillasCuenta = [
    [
      'verificarEmail',
      verificarEmail,
      'Verifica tu email en AgendaFlow',
      '24 horas',
    ],
    [
      'restablecerContrasena',
      restablecerContrasena,
      'Restablece tu contraseña de AgendaFlow',
      '1 hora',
    ],
  ] as const;

  describe.each(plantillasCuenta)('%s', (_n, plantilla, asunto, vigencia) => {
    it('usa el asunto del spec', () => {
      expect(plantilla({ nombre: 'Ana', enlace }).subject).toBe(asunto);
    });

    it('escapa el nombre en el HTML', () => {
      const { html } = plantilla({ nombre: '<b>x</b>', enlace });
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(html).not.toContain('<b>x</b>');
    });

    it('incluye el enlace en el HTML y en el texto', () => {
      const { html, text } = plantilla({ nombre: 'Ana', enlace });
      expect(html).toContain(`href="${escapeHtml(enlace)}"`);
      expect(text).toContain(enlace);
    });

    it('indica la vigencia y qué hacer si no fue el usuario', () => {
      const { html, text } = plantilla({ nombre: 'Ana', enlace });
      for (const contenido of [html, text]) {
        expect(contenido).toContain(vigencia);
        expect(contenido).toContain('Si no fuiste tú, ignora este correo');
      }
    });

    it('usa el pie de AgendaFlow, sin repetir la marca', () => {
      const { html, text } = plantilla({ nombre: 'Ana', enlace });
      for (const contenido of [html, text]) {
        expect(contenido).toContain('Este correo fue enviado por AgendaFlow.');
        expect(contenido).not.toContain('a través de AgendaFlow');
      }
    });
  });
});

describe('pie de los correos de reservas', () => {
  it.each(plantillas)('%s conserva su pie original', (_nombre, plantilla) => {
    const { html, text } = plantilla(marca, datosBase);
    const pie =
      'Este correo fue enviado por Barbería Central a través de AgendaFlow.';
    expect(html).toContain(pie);
    expect(text).toContain(pie);
  });
});

describe('enlace de cancelación en la confirmación (SPEC 07)', () => {
  const cancelacion = {
    url: 'https://app.agendaflow.cl/reserva/cancelar?token=abc123',
    limite: 'miércoles, 11 de noviembre de 2026 a las 10:00',
  };

  it('con enlace, muestra el botón "Cancelar mi reserva" y el plazo', () => {
    const correo = reservaConfirmadaCliente(marca, datosBase, cancelacion);

    expect(correo.html).toContain('Cancelar mi reserva');
    expect(correo.html).toContain(
      'href="https://app.agendaflow.cl/reserva/cancelar?token=abc123"',
    );
    expect(correo.html).toContain(
      'Puedes cancelar online hasta el <strong>miércoles, 11 de noviembre de 2026 a las 10:00</strong>',
    );
    // El botón usa el color de la empresa.
    expect(correo.html).toContain('bgcolor="#0f766e"');
    expect(correo.text).toContain(
      'Puedes cancelar online hasta el miércoles, 11 de noviembre de 2026 a las 10:00:',
    );
    expect(correo.text).toContain(cancelacion.url);
  });

  it('con enlace, el texto de contacto queda para después del plazo', () => {
    const correo = reservaConfirmadaCliente(marca, datosBase, cancelacion);
    expect(correo.text).toContain(
      'Después de ese plazo, o si necesitas cambiar tu hora, responde este correo o contacta directamente a Barbería Central.',
    );
    expect(correo.text).not.toContain(
      'Si necesitas cambiar o cancelar tu hora',
    );
  });

  it('sin enlace, no hay botón y se mantiene el texto de contacto', () => {
    const correo = reservaConfirmadaCliente(marca, datosBase);
    expect(correo.html).not.toContain('Cancelar mi reserva');
    expect(correo.html).not.toContain('/reserva/cancelar');
    expect(correo.text).toContain(
      'Si necesitas cambiar o cancelar tu hora, responde este correo o contacta directamente a Barbería Central.',
    );
  });

  it('escapa la URL y el plazo en el HTML', () => {
    const correo = reservaConfirmadaCliente(marca, datosBase, {
      url: 'https://x.cl/reserva/cancelar?token=a"b<c',
      limite: '<script>',
    });
    expect(correo.html).not.toContain('a"b<c');
    expect(correo.html).not.toContain('<script>');
  });

  it('formatearInstante muestra el instante en hora de Chile', () => {
    // 18:00 UTC en diciembre = 15:00 en Chile (UTC-3).
    expect(formatearInstante(new Date('2026-12-09T18:00:00Z'))).toBe(
      'miércoles, 9 de diciembre de 2026 a las 15:00',
    );
    // 19:00 UTC en julio = 15:00 en Chile (UTC-4).
    expect(formatearInstante(new Date('2026-07-09T19:00:00Z'))).toBe(
      'jueves, 9 de julio de 2026 a las 15:00',
    );
  });
});

describe('cancelacionCliente (SPEC 07)', () => {
  it('cancelada con reembolso: monto en el asunto y nota de Flow', () => {
    const correo = cancelacionCliente(marca, datosBase, {
      cancelada: true,
      reembolso: '$4.323',
    });
    expect(correo.subject).toBe(
      'Reserva cancelada en Barbería Central – reembolso de $4.323',
    );
    expect(correo.text).toContain(
      'Cancelamos tu reserva en Barbería Central y te reembolsaremos $4.323.',
    );
    expect(correo.text).toContain('Flow procesará la devolución');
    expect(correo.html).toContain('Flow procesará la devolución');
  });

  it('cancelada sin reembolso: sin nota de Flow', () => {
    const correo = cancelacionCliente(marca, datosBase, {
      cancelada: true,
      reembolso: null,
    });
    expect(correo.subject).toBe('Tu reserva en Barbería Central fue cancelada');
    expect(correo.text).toContain('La hora quedó libre.');
    expect(correo.text).not.toContain('Flow procesará');
    expect(correo.html).not.toContain('Flow procesará');
  });

  it('reembolso sin cancelar sobre una reserva Programada: la hora sigue', () => {
    const correo = cancelacionCliente(
      marca,
      { ...datosBase, estado: { nombre: 'Programada', color: null } },
      { cancelada: false, reembolso: '$1.000' },
    );
    expect(correo.subject).toBe('Reembolso de $1.000 de Barbería Central');
    expect(correo.text).toContain(
      'Barbería Central te reembolsará $1.000 de tu reserva. Tu hora sigue agendada.',
    );
  });

  it('reembolso sin cancelar sobre una reserva Anulado (pago tardío): no dice que la hora sigue', () => {
    const correo = cancelacionCliente(
      marca,
      { ...datosBase, estado: { nombre: 'Anulado', color: null } },
      { cancelada: false, reembolso: '$4.323' },
    );
    expect(correo.text).not.toContain('Tu hora sigue agendada');
  });

  it('escapa el nombre del cliente en el HTML', () => {
    const correo = cancelacionCliente(
      marca,
      { ...datosBase, clienteNombre: '<b>x</b>' },
      { cancelada: true, reembolso: null },
    );
    expect(correo.html).not.toContain('<b>x</b>');
  });
});

describe('reembolsoRechazadoInterno (SPEC 07)', () => {
  const datos = {
    monto: '$4.323',
    error: 'Flow informó rejected',
    urlPanel: 'https://app.agendaflow.cl/admin/pagos',
  };

  it('asunto con monto y cliente, motivo de Flow y botón al panel', () => {
    const correo = reembolsoRechazadoInterno(marca, datosBase, datos);
    expect(correo.subject).toBe(
      'Flow rechazó un reembolso de $4.323 – Carlos López',
    );
    expect(correo.html).toContain('Flow informó rejected');
    expect(correo.html).toContain(
      'href="https://app.agendaflow.cl/admin/pagos"',
    );
    expect(correo.html).toContain('Ir a pagos');
    expect(correo.text).toContain('https://app.agendaflow.cl/admin/pagos');
    expect(correo.text).toContain('Revisa tu saldo en Flow');
  });

  it('incluye los datos de contacto del cliente (es un aviso interno)', () => {
    const correo = reembolsoRechazadoInterno(marca, datosBase, datos);
    expect(correo.text).toContain('carlos@email.com');
    expect(correo.text).toContain('977777777');
  });
});
