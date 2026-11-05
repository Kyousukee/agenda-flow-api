import { formatearFecha, formatearHora, formatearPrecio } from './formato';
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
