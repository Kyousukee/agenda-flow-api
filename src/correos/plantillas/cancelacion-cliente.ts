import {
  DatosReservaCorreo,
  MarcaEmpresa,
  PlantillaCorreo,
  detalleTexto,
  escapeHtml,
  filasReserva,
  layoutCorreo,
  notaSuave,
  parrafo,
  pieTexto,
  tablaDetalle,
} from './layout';

/** SPEC 07: qué pasó con la reserva y cuánto se reembolsa. */
export interface DatosCancelacionCliente {
  /** La reserva quedó Cancelada en esta operación. */
  cancelada: boolean;
  /** Monto reembolsado ya formateado ("$4.323"), o null si no hay reembolso. */
  reembolso: string | null;
}

const NOTA_REEMBOLSO =
  'Flow procesará la devolución al medio de pago que usaste. Puede tardar algunos días hábiles en verse reflejada.';

/**
 * Al cliente cuando cancela desde el enlace o cuando el local le reembolsa desde el panel.
 * Tres variantes: cancelada sin reembolso, cancelada con reembolso y reembolso sin cancelar.
 */
export function cancelacionCliente(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
  { cancelada, reembolso }: DatosCancelacionCliente,
): PlantillaCorreo {
  const filas = filasReserva(datos);

  let titulo: string;
  let mensaje: string;
  let subject: string;
  if (cancelada && reembolso) {
    titulo = 'Tu reserva fue cancelada';
    mensaje = `Cancelamos tu reserva en ${marca.nombre} y te reembolsaremos ${reembolso}.`;
    subject = `Reserva cancelada en ${marca.nombre} – reembolso de ${reembolso}`;
  } else if (cancelada) {
    titulo = 'Tu reserva fue cancelada';
    mensaje = `Cancelamos tu reserva en ${marca.nombre}. La hora quedó libre.`;
    subject = `Tu reserva en ${marca.nombre} fue cancelada`;
  } else {
    // Reembolso sin cancelar: compensación sobre una hora vigente o pago tardío de una reserva anulada.
    titulo = 'Te reembolsamos un pago';
    const sigue =
      datos.estado.nombre === 'Programada' ? ' Tu hora sigue agendada.' : '';
    mensaje = `${marca.nombre} te reembolsará ${reembolso ?? ''} de tu reserva.${sigue}`;
    subject = `Reembolso de ${reembolso ?? ''} de ${marca.nombre}`;
  }

  const html = layoutCorreo({
    marca,
    titulo,
    preheader: mensaje,
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(datos.clienteNombre)}</strong>,`),
      parrafo(escapeHtml(mensaje)),
      tablaDetalle(filas),
      ...(reembolso ? [notaSuave(escapeHtml(NOTA_REEMBOLSO))] : []),
      notaSuave(
        `Si tienes dudas, responde este correo o contacta directamente a ${escapeHtml(marca.nombre)}.`,
      ),
    ].join('\n'),
  });

  const text = [
    `Hola ${datos.clienteNombre},`,
    '',
    mensaje,
    '',
    detalleTexto(filas),
    '',
    ...(reembolso ? [NOTA_REEMBOLSO, ''] : []),
    `Si tienes dudas, responde este correo o contacta directamente a ${marca.nombre}.`,
    '',
    pieTexto(marca),
  ].join('\n');

  return { subject, html, text };
}
