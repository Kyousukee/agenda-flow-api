export interface TextoEstado {
  /** Título grande del correo al cliente. */
  titulo: string;
  /** Párrafo explicativo para el cliente. */
  mensaje: string;
  /** Forma en minúscula y concordada con "tu reserva está …". */
  adjetivo: string;
}

const TEXTOS: Record<string, TextoEstado> = {
  programada: {
    titulo: 'Tu reserva está confirmada',
    mensaje: 'Tu hora quedó agendada. Te esperamos en la fecha indicada.',
    adjetivo: 'programada',
  },
  pendiente: {
    titulo: 'Tu reserva está pendiente de confirmación',
    mensaje:
      'Recibimos tu solicitud y la estamos revisando. Te avisaremos cuando quede confirmada.',
    adjetivo: 'pendiente',
  },
  completada: {
    titulo: '¡Gracias por tu visita!',
    mensaje:
      'Tu atención quedó registrada como completada. ¡Esperamos verte pronto!',
    adjetivo: 'completada',
  },
  pagado: {
    titulo: 'Recibimos tu pago',
    mensaje: 'El pago de tu reserva quedó registrado correctamente.',
    adjetivo: 'pagada',
  },
  cancelada: {
    titulo: 'Tu reserva fue cancelada',
    mensaje:
      'Tu reserva fue cancelada. Si quieres agendar una nueva hora, puedes hacerlo cuando quieras.',
    adjetivo: 'cancelada',
  },
  rechazado: {
    titulo: 'Tu reserva no pudo ser aceptada',
    mensaje:
      'Lamentablemente no pudimos aceptar tu reserva. Puedes intentar agendar en otro horario.',
    adjetivo: 'rechazada',
  },
  anulado: {
    titulo: 'Tu reserva fue anulada',
    mensaje:
      'Tu reserva fue anulada. Si crees que se trata de un error, responde este correo.',
    adjetivo: 'anulada',
  },
};

/** Texto para un `Estado.Nombre`; para un estado desconocido devuelve uno genérico. */
export function textoEstado(nombreEstado: string): TextoEstado {
  const clave = nombreEstado.trim().toLowerCase();
  return (
    TEXTOS[clave] ?? {
      titulo: `Tu reserva cambió a "${nombreEstado}"`,
      mensaje: `El estado de tu reserva ahora es "${nombreEstado}".`,
      adjetivo: clave,
    }
  );
}
