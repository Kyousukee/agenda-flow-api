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

export interface DatosEnlaceCuenta {
  nombre: string;
  enlace: string;
}

/** Correo para confirmar el email de una cuenta nueva. El enlace vence en 24 horas. */
export function verificarEmail({
  nombre,
  enlace,
}: DatosEnlaceCuenta): PlantillaCorreo {
  const titulo = 'Verifica tu email';
  const enlaceHtml = escapeHtml(enlace);

  const html = layoutCorreo({
    marca: MARCA_AGENDAFLOW,
    pie: PIE_AGENDAFLOW,
    titulo,
    preheader: 'Confirma tu email para terminar de activar tu cuenta.',
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(nombre)}</strong>,`),
      parrafo('Confirma que este email es tuyo para terminar tu registro.'),
      botonAccion(enlace, 'Verificar email'),
      notaSuave(
        `El enlace vence en 24 horas. Si el botón no funciona, copia este enlace en tu navegador:<br /><a href="${enlaceHtml}" style="word-break:break-all;">${enlaceHtml}</a>`,
      ),
      notaSuave('Si no fuiste tú, ignora este correo.'),
    ].join('\n'),
  });

  const text = [
    `Hola ${nombre},`,
    '',
    'Confirma que este email es tuyo para terminar tu registro:',
    '',
    enlace,
    '',
    'El enlace vence en 24 horas.',
    'Si no fuiste tú, ignora este correo.',
    '',
    pieTexto(MARCA_AGENDAFLOW, PIE_AGENDAFLOW),
  ].join('\n');

  return { subject: 'Verifica tu email en AgendaFlow', html, text };
}
