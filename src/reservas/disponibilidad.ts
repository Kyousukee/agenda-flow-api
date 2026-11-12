import { EntityManager } from 'typeorm';
import { Reserva } from './entities/reserva.entity';
import { Bloqueo } from '../bloqueos/entities/bloqueo.entity';

/** Estados de reserva que dejan la hora libre. */
export const ESTADOS_QUE_LIBERAN = ['Cancelada', 'Rechazado', 'Anulado'];

/**
 * ¿El empleado tiene otra reserva activa o un bloqueo que se cruce con ese tramo?
 * La usan la creación de reservas y la reactivación por pago tardío (SPEC 06).
 */
export async function horaOcupada(
  manager: EntityManager,
  tramo: {
    empleadoId: number;
    fecha: string;
    horaInicio: string;
    horaFin: string;
    /** La propia reserva que se quiere reactivar. */
    excluirReservaId?: number;
  },
): Promise<boolean> {
  const solape = { inicio: tramo.horaInicio, fin: tramo.horaFin };

  const consulta = manager
    .createQueryBuilder(Reserva, 'reserva')
    .leftJoin('reserva.estado', 'estado')
    .where('reserva.EmpleadoId = :empleadoId', {
      empleadoId: tramo.empleadoId,
    })
    .andWhere('reserva.fecha = :fecha', { fecha: tramo.fecha })
    .andWhere('reserva.horaInicio < :fin AND reserva.horaFin > :inicio', solape)
    .andWhere('(estado.nombre IS NULL OR estado.nombre NOT IN (:...libres))', {
      libres: ESTADOS_QUE_LIBERAN,
    });
  if (tramo.excluirReservaId !== undefined) {
    consulta.andWhere('reserva.Id <> :excluir', {
      excluir: tramo.excluirReservaId,
    });
  }
  const reservas = await consulta.getCount();

  const bloqueos = await manager
    .createQueryBuilder(Bloqueo, 'bloqueo')
    .where('bloqueo.EmpleadoId = :empleadoId', {
      empleadoId: tramo.empleadoId,
    })
    .andWhere('bloqueo.fecha = :fecha', { fecha: tramo.fecha })
    .andWhere('bloqueo.horaInicio < :fin AND bloqueo.horaFin > :inicio', solape)
    .getCount();

  return reservas > 0 || bloqueos > 0;
}
