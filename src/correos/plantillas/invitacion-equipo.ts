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

export interface DatosInvitacionEquipo {
  /** Nombre del recepcionista invitado. */
  nombre: string;
  enlace: string;
  /** Nombre comercial (o nombre) del negocio. */
  empresa: string;
  sucursal: string;
  /** Nombre de quien invita (el dueño). */
  invitadoPor: string;
}

/**
 * SPEC 08: invitación a un recepcionista para que cree su contraseña.
 * El enlace vence en 7 días (VIGENCIA_INVITACION_MS).
 */
export function invitacionEquipo({
  nombre,
  enlace,
  empresa,
  sucursal,
  invitadoPor,
}: DatosInvitacionEquipo): PlantillaCorreo {
  const titulo = `Te invitaron a ${empresa}`;
  const enlaceHtml = escapeHtml(enlace);
  const invitacion = `${invitadoPor} te invitó a la agenda de ${empresa} — ${sucursal} en AgendaFlow, como recepcionista.`;

  const html = layoutCorreo({
    marca: MARCA_AGENDAFLOW,
    pie: PIE_AGENDAFLOW,
    titulo,
    preheader: 'Crea tu contraseña para empezar a usar la agenda.',
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(nombre)}</strong>,`),
      parrafo(
        `<strong>${escapeHtml(invitadoPor)}</strong> te invitó a la agenda de <strong>${escapeHtml(empresa)} — ${escapeHtml(sucursal)}</strong> en AgendaFlow, como recepcionista.`,
      ),
      parrafo(
        'Podrás ver y agendar reservas, y registrar los pagos de la sucursal.',
      ),
      botonAccion(enlace, 'Crear mi contraseña'),
      notaSuave(
        `El enlace vence en 7 días. Si el botón no funciona, copia este enlace en tu navegador:<br /><a href="${enlaceHtml}" style="word-break:break-all;">${enlaceHtml}</a>`,
      ),
      notaSuave(
        'Si no esperabas esta invitación, ignora este correo. No se activará ninguna cuenta.',
      ),
    ].join('\n'),
  });

  const text = [
    `Hola ${nombre},`,
    '',
    invitacion,
    'Podrás ver y agendar reservas, y registrar los pagos de la sucursal.',
    '',
    'Crea tu contraseña aquí:',
    enlace,
    '',
    'El enlace vence en 7 días.',
    'Si no esperabas esta invitación, ignora este correo. No se activará ninguna cuenta.',
    '',
    pieTexto(MARCA_AGENDAFLOW, PIE_AGENDAFLOW),
  ].join('\n');

  return {
    subject: `${invitadoPor} te invitó a ${empresa} en AgendaFlow`,
    html,
    text,
  };
}
