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

/** Confirmación al cliente cuando agenda una hora. */
export function reservaConfirmadaCliente(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
): PlantillaCorreo {
  const titulo = '¡Tu reserva está confirmada!';
  const filas = filasReserva(datos);

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
      notaSuave(
        `Si necesitas cambiar o cancelar tu hora, responde este correo o contacta directamente a ${escapeHtml(marca.nombre)}.`,
      ),
    ].join('\n'),
  });

  const text = [
    `Hola ${datos.clienteNombre},`,
    '',
    `Tu hora en ${marca.nombre} quedó agendada. Estos son los detalles:`,
    '',
    detalleTexto(filas),
    '',
    `Si necesitas cambiar o cancelar tu hora, responde este correo o contacta directamente a ${marca.nombre}.`,
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Reserva confirmada en ${marca.nombre} – ${datos.fechaCorta} ${datos.horaInicio}`,
    html,
    text,
  };
}
