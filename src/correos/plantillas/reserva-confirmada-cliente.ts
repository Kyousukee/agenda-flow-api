import {
  DatosReservaCorreo,
  MarcaEmpresa,
  PlantillaCorreo,
  botonAccion,
  detalleTexto,
  escapeHtml,
  filasReserva,
  layoutCorreo,
  notaSuave,
  parrafo,
  pieTexto,
  tablaDetalle,
} from './layout';

/** SPEC 07: enlace público para cancelar, con el plazo ya formateado. */
export interface CancelacionOnline {
  url: string;
  /** "miércoles, 9 de diciembre de 2026 a las 15:00" */
  limite: string;
}

/**
 * Confirmación al cliente cuando agenda una hora. Con `cancelacion`, muestra el botón
 * "Cancelar mi reserva" y el plazo. Sin ella (sin token o con el plazo vencido), el
 * cliente contacta al local como antes.
 */
export function reservaConfirmadaCliente(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
  cancelacion: CancelacionOnline | null = null,
): PlantillaCorreo {
  const titulo = '¡Tu reserva está confirmada!';
  const filas = filasReserva(datos);
  const contacto = `Si necesitas cambiar o cancelar tu hora, responde este correo o contacta directamente a ${marca.nombre}.`;

  const cierreHtml = cancelacion
    ? [
        parrafo(
          `Puedes cancelar online hasta el <strong>${escapeHtml(cancelacion.limite)}</strong>.`,
        ),
        botonAccion(
          cancelacion.url,
          'Cancelar mi reserva',
          marca.colorPrincipal,
        ),
        notaSuave(
          `Después de ese plazo, o si necesitas cambiar tu hora, responde este correo o contacta directamente a ${escapeHtml(marca.nombre)}.`,
        ),
      ]
    : [notaSuave(escapeHtml(contacto))];

  const cierreTexto = cancelacion
    ? [
        `Puedes cancelar online hasta el ${cancelacion.limite}:`,
        cancelacion.url,
        '',
        `Después de ese plazo, o si necesitas cambiar tu hora, responde este correo o contacta directamente a ${marca.nombre}.`,
      ]
    : [contacto];

  const html = layoutCorreo({
    marca,
    titulo,
    preheader: `${datos.servicio} el ${datos.fecha} a las ${datos.horaInicio}`,
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(datos.clienteNombre)}</strong>,`),
      parrafo(
        `Tu hora en <strong>${escapeHtml(marca.nombre)}</strong> quedó agendada. Estos son los detalles:`,
      ),
      tablaDetalle(filas),
      ...cierreHtml,
    ].join('\n'),
  });

  const text = [
    `Hola ${datos.clienteNombre},`,
    '',
    `Tu hora en ${marca.nombre} quedó agendada. Estos son los detalles:`,
    '',
    detalleTexto(filas),
    '',
    ...cierreTexto,
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Reserva confirmada en ${marca.nombre} – ${datos.fechaCorta} ${datos.horaInicio}`,
    html,
    text,
  };
}
