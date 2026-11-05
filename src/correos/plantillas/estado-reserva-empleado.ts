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

/** Aviso al empleado asignado cuando cambia el estado de una reserva. */
export function estadoReservaEmpleado(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
  nombreEmpleado?: string | null,
): PlantillaCorreo {
  const titulo = 'Una reserva cambió de estado';
  const saludo = nombreEmpleado ? `Hola ${nombreEmpleado},` : 'Hola,';
  const mensaje = `La reserva de ${datos.clienteNombre} ahora está en estado "${datos.estado.nombre}".`;

  const filas: FilaDetalle[] = [
    ['Cliente', datos.clienteNombre],
    ['Teléfono cliente', datos.clienteTelefono],
    ...filasReserva(datos),
  ];

  const html = layoutCorreo({
    marca,
    titulo,
    preheader: mensaje,
    contenidoHtml: [
      parrafo(escapeHtml(saludo)),
      parrafo(escapeHtml(mensaje)),
      parrafo(`Nuevo estado: ${badgeEstado(datos.estado)}`),
      tablaDetalle(filas),
    ].join('\n'),
  });

  const text = [
    saludo,
    '',
    mensaje,
    '',
    detalleTexto(filas),
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Reserva de ${datos.clienteNombre} cambió a ${datos.estado.nombre}`,
    html,
    text,
  };
}
