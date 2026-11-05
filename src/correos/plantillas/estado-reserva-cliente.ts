import {
  DatosReservaCorreo,
  MarcaEmpresa,
  PlantillaCorreo,
  badgeEstado,
  detalleTexto,
  escapeHtml,
  filasReserva,
  layoutCorreo,
  notaSuave,
  parrafo,
  pieTexto,
  tablaDetalle,
} from './layout';
import { textoEstado } from './textos-estado';

/** Aviso al cliente cuando cambia el estado de su reserva. */
export function estadoReservaCliente(
  marca: MarcaEmpresa,
  datos: DatosReservaCorreo,
): PlantillaCorreo {
  const texto = textoEstado(datos.estado.nombre);
  const filas = filasReserva(datos);

  const html = layoutCorreo({
    marca,
    titulo: texto.titulo,
    preheader: texto.mensaje,
    contenidoHtml: [
      parrafo(`Hola <strong>${escapeHtml(datos.clienteNombre)}</strong>,`),
      parrafo(escapeHtml(texto.mensaje)),
      parrafo(`Nuevo estado: ${badgeEstado(datos.estado)}`),
      tablaDetalle(filas),
      notaSuave(
        `¿Tienes dudas? Responde este correo y te contactará ${escapeHtml(marca.nombre)}.`,
      ),
    ].join('\n'),
  });

  const text = [
    `Hola ${datos.clienteNombre},`,
    '',
    texto.titulo,
    texto.mensaje,
    `Nuevo estado: ${datos.estado.nombre}`,
    '',
    detalleTexto(filas),
    '',
    `¿Tienes dudas? Responde este correo y te contactará ${marca.nombre}.`,
    '',
    pieTexto(marca),
  ].join('\n');

  return {
    subject: `Tu reserva en ${marca.nombre} está ${texto.adjetivo}`,
    html,
    text,
  };
}
