import {
  DatosReservaCorreo,
  FilaDetalle,
  MarcaEmpresa,
  PlantillaCorreo,
  badgeEstado,
  detalleTexto,
  escapeHtml,
  filasReserva,
  layoutCorreo,
  parrafo,
  pieTexto,
  tablaDetalle,
} from './layout';

/**
 * Aviso interno de reserva nueva. Se usa para la empresa y para el empleado:
 * con `nombreDestinatario` saluda al empleado; sin él, al equipo de la empresa.
 */
export function reservaNuevaInterna(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
  nombreDestinatario?: string | null,
): PlantillaCorreo {
  const titulo = 'Nueva reserva';
  const saludo = nombreDestinatario
    ? `Hola ${nombreDestinatario},`
    : `Hola equipo de ${marca.nombre},`;
  const intro = nombreDestinatario
    ? 'Tienes una nueva reserva agendada:'
    : 'Se agendó una nueva reserva:';

  const filas: FilaDetalle[] = [
    ['Cliente', datos.clienteNombre],
    ['Email cliente', datos.clienteEmail],
    ['Teléfono cliente', datos.clienteTelefono],
    ...filasReserva(datos),
  ];

  const html = layoutCorreo({
    marca,
    titulo,
    preheader: `${datos.clienteNombre} – ${datos.servicio} – ${datos.fecha} ${datos.horaInicio}`,
    contenidoHtml: [
      parrafo(escapeHtml(saludo)),
      parrafo(escapeHtml(intro)),
      parrafo(`Estado: ${badgeEstado(datos.estado)}`),
      tablaDetalle(filas),
    ].join('\n'),
  });

  const text = [
    saludo,
    '',
    intro,
    `Estado: ${datos.estado.nombre}`,
    '',
    detalleTexto(filas),
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Nueva reserva: ${datos.clienteNombre} – ${datos.servicio} – ${datos.fechaCorta} ${datos.horaInicio}`,
    html,
    text,
  };
}
