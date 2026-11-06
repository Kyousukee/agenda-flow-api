import {
  MARCA_AGENDAFLOW,
  PIE_AGENDAFLOW,
  PlantillaCorreo,
  botonAccion,
  escapeHtml,
  layoutCorreo,
  notaSuave,
  parrafo,
  pieTexto,
} from './layout';
import { DatosEnlaceCuenta } from './verificar-email';

/** Correo para restablecer una contraseña olvidada. El enlace vence en 1 hora. */
export function restablecerContrasena({
  nombre,
  enlace,
}: DatosEnlaceCuenta): PlantillaCorreo {
  const titulo = 'Restablece tu contraseña';
  const enlaceHtml = escapeHtml(enlace);

  const html = layoutCorreo({
    marca: MARCA_AGENDAFLOW,
    pie: PIE_AGENDAFLOW,
    titulo,
    preheader: 'Usa este enlace para crear una contraseña nueva.',
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(nombre)}</strong>,`),
      parrafo(
        'Recibimos una solicitud para restablecer tu contraseña. Al hacerlo, se cerrarán todas tus sesiones abiertas.',
      ),
      botonAccion(enlace, 'Restablecer contraseña'),
      notaSuave(
        `El enlace vence en 1 hora. Si el botón no funciona, copia este enlace en tu navegador:<br /><a href="${enlaceHtml}" style="word-break:break-all;">${enlaceHtml}</a>`,
      ),
      notaSuave(
        'Si no fuiste tú, ignora este correo. Tu contraseña no cambiará.',
      ),
    ].join('\n'),
  });

  const text = [
    `Hola ${nombre},`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña. Al hacerlo, se cerrarán todas tus sesiones abiertas.',
    '',
    enlace,
    '',
    'El enlace vence en 1 hora.',
    'Si no fuiste tú, ignora este correo. Tu contraseña no cambiará.',
    '',
    pieTexto(MARCA_AGENDAFLOW, PIE_AGENDAFLOW),
  ].join('\n');

  return { subject: 'Restablece tu contraseña de AgendaFlow', html, text };
}
