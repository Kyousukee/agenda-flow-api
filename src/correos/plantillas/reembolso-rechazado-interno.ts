import {
  DatosReservaCorreo,
  FilaDetalle,
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

/** SPEC 07: reembolso que Flow aceptó y después rechazó. */
export interface DatosReembolsoRechazado {
  /** Ya formateado ("$4.323"). */
  monto: string;
  /** Mensaje o estado que informó Flow. */
  error: string | null;
  /** Panel de pagos del front: `${FRONT_URL}/admin/pagos`. */
  urlPanel: string;
}

/** Aviso al local: hay que revisar el saldo en Flow y reintentar el reembolso desde el panel. */
export function reembolsoRechazadoInterno(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
  { monto, error, urlPanel }: DatosReembolsoRechazado,
): PlantillaCorreo {
  const titulo = 'Flow rechazó un reembolso';
  const mensaje = `Flow rechazó el reembolso de ${monto} a ${datos.clienteNombre}. El cliente todavía no recibe su dinero.`;
  const accion =
    'Revisa tu saldo en Flow y vuelve a intentarlo desde el panel de pagos. Si la reserva estaba cancelada, sigue cancelada.';

  const filas: FilaDetalle[] = [
    ['Monto', monto],
    ['Motivo de Flow', error],
    ['Cliente', datos.clienteNombre],
    ['Email cliente', datos.clienteEmail],
    ['Teléfono cliente', datos.clienteTelefono],
    ...filasReserva(datos),
  ];

  const html = layoutCorreo({
    marca,
    titulo,
    preheader: mensaje,
    contenidoHtml: [
      parrafo(escapeHtml(mensaje)),
      tablaDetalle(filas),
      parrafo(escapeHtml(accion)),
      botonAccion(urlPanel, 'Ir a pagos', marca.colorPrincipal),
      notaSuave(
        'Este aviso se envía una sola vez por cada reembolso rechazado.',
      ),
    ].join('\n'),
  });

  const text = [
    mensaje,
    '',
    detalleTexto(filas),
    '',
    accion,
    urlPanel,
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Flow rechazó un reembolso de ${monto} – ${datos.clienteNombre}`,
    html,
    text,
  };
}
