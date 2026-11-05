/**
 * Layout común de los correos: tablas + CSS inline (compatible con Gmail/Outlook),
 * sin <style> ni fuentes externas.
 */

export interface PlantillaCorreo {
  subject: string;
  html: string;
  text: string;
}

export interface MarcaEmpresa {
  nombre: string;
  logoUrl: string | null;
  /** Ya validado; usar `colorValido()` al construirla. */
  colorPrincipal: string;
  telefono: string | null;
  email: string | null;
}

export interface DatosReservaCorreo {
  /** Primeros 8 caracteres del UUID en mayúsculas. */
  codigo: string;
  clienteNombre: string;
  clienteEmail: string | null;
  clienteTelefono: string | null;
  servicio: string;
  duracionMinutos: number;
  /** "Nombre Apellido" */
  empleado: string | null;
  sucursal: string;
  direccion: string | null;
  /** "jueves, 12 de noviembre de 2026" */
  fecha: string;
  /** "jue, 12 nov" — para asuntos. */
  fechaCorta: string;
  /** "10:00 – 10:30" */
  hora: string;
  /** "10:00" — para asuntos. */
  horaInicio: string;
  /** "$15.000" o null si la empresa no muestra precios. */
  precio: string | null;
  observacion: string | null;
  estado: { nombre: string; color: string | null };
}

export const COLOR_POR_DEFECTO = '#4F46E5';
export const COLOR_ESTADO_POR_DEFECTO = '#6b7280';

const FUENTE = 'Arial, Helvetica, sans-serif';
const COLOR_TEXTO = '#1f2937';
const COLOR_SUAVE = '#6b7280';

export function escapeHtml(valor: string | number | null | undefined): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Devuelve el color si es un #hex válido (3 o 6 dígitos); si no, el fallback. */
export function colorValido(
  color: string | null | undefined,
  fallback: string = COLOR_POR_DEFECTO,
): string {
  const limpio = color?.trim();
  return limpio && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(limpio)
    ? limpio
    : fallback;
}

/** Texto blanco u oscuro según la luminosidad del fondo, para que siempre se lea. */
export function colorTextoSobre(fondo: string): string {
  let hex = fondo.replace('#', '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.65 ? '#111827' : '#ffffff';
}

export function badgeEstado(estado: DatosReservaCorreo['estado']): string {
  const fondo = colorValido(estado.color, COLOR_ESTADO_POR_DEFECTO);
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background-color:${fondo};color:${colorTextoSobre(fondo)};font-family:${FUENTE};font-size:13px;font-weight:bold;">${escapeHtml(estado.nombre)}</span>`;
}

export function parrafo(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${COLOR_TEXTO};">${html}</p>`;
}

export function notaSuave(html: string): string {
  return `<p style="margin:16px 0 0 0;font-family:${FUENTE};font-size:13px;line-height:1.5;color:${COLOR_SUAVE};">${html}</p>`;
}

/** Fila etiqueta/valor; se omite si el valor está vacío. El valor se escapa. */
export type FilaDetalle = [etiqueta: string, valor: string | null | undefined];

export function tablaDetalle(filas: FilaDetalle[]): string {
  const filasHtml = filas
    .filter(
      ([, valor]) => valor !== null && valor !== undefined && valor !== '',
    )
    .map(
      ([etiqueta, valor]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eef0f3;font-family:${FUENTE};font-size:13px;color:${COLOR_SUAVE};width:38%;vertical-align:top;">${escapeHtml(etiqueta)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef0f3;font-family:${FUENTE};font-size:14px;color:${COLOR_TEXTO};font-weight:bold;vertical-align:top;">${escapeHtml(valor)}</td>
        </tr>`,
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:8px 0 8px 0;background-color:#f9fafb;border-radius:8px;">
      <tr><td style="padding:8px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${filasHtml}
        </table>
      </td></tr>
    </table>`;
}

/** Filas estándar del detalle de una reserva (las vacías se omiten al renderizar). */
export function filasReserva(datos: DatosReservaCorreo): FilaDetalle[] {
  return [
    ['Servicio', `${datos.servicio} (${datos.duracionMinutos} min)`],
    ['Fecha', datos.fecha],
    ['Hora', datos.hora],
    ['Profesional', datos.empleado],
    ['Sucursal', datos.sucursal],
    ['Dirección', datos.direccion],
    ['Precio', datos.precio],
    ['Notas', datos.observacion],
    ['Código', datos.codigo],
  ];
}

/** Versión en texto plano de una tabla de detalle. */
export function detalleTexto(filas: FilaDetalle[]): string {
  return filas
    .filter(
      ([, valor]) => valor !== null && valor !== undefined && valor !== '',
    )
    .map(([etiqueta, valor]) => `${etiqueta}: ${valor}`)
    .join('\n');
}

export function pieTexto(marca: MarcaEmpresa): string {
  const contacto = [marca.telefono, marca.email].filter(Boolean).join(' · ');
  return [
    '—',
    `Este correo fue enviado por ${marca.nombre} a través de AgendaFlow.`,
    contacto,
  ]
    .filter(Boolean)
    .join('\n');
}

interface OpcionesLayout {
  marca: MarcaEmpresa;
  /** Texto de vista previa que muestran los clientes de correo junto al asunto. */
  preheader: string;
  titulo: string;
  /** HTML del cuerpo; quien lo arma es responsable de escapar los valores. */
  contenidoHtml: string;
}

export function layoutCorreo({
  marca,
  preheader,
  titulo,
  contenidoHtml,
}: OpcionesLayout): string {
  const color = colorValido(marca.colorPrincipal);
  const colorTexto = colorTextoSobre(color);
  const nombre = escapeHtml(marca.nombre);

  const encabezado = marca.logoUrl
    ? `<img src="${escapeHtml(marca.logoUrl)}" alt="${nombre}" height="64" style="display:block;margin:0 auto;max-height:120px;height:64px;width:auto;border:0;outline:none;text-decoration:none;font-family:${FUENTE};font-size:22px;font-weight:bold;color:${colorTexto};" />`
    : `<span style="font-family:${FUENTE};font-size:22px;font-weight:bold;color:${colorTexto};">${nombre}</span>`;

  const contacto = [marca.telefono, marca.email]
    .filter(Boolean)
    .map((v) => escapeHtml(v))
    .join(' &middot; ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(titulo)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td align="center" bgcolor="${color}" style="background-color:${color};padding:28px 24px;">
              ${encabezado}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <h1 style="margin:0 0 20px 0;font-family:${FUENTE};font-size:22px;line-height:1.3;color:${COLOR_TEXTO};">${escapeHtml(titulo)}</h1>
              ${contenidoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #eef0f3;">
              <p style="margin:0;font-family:${FUENTE};font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">
                Este correo fue enviado por ${nombre} a través de AgendaFlow.${contacto ? `<br />${contacto}` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
