import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { Estado } from '../reservas/entities/estado.entity';

/**
 * SPEC 06: UPDATE condicional del estado de un pago o una reserva (columnas `Id` y `EstadoId`).
 * Solo cambia si el estado actual cumple la condición, así confirmación, retorno y
 * anulación pueden correr a la vez sin repetir efectos.
 * Devuelve true si cambió una fila; false si otro proceso ya hizo la transición.
 */
export async function cambiarEstado<T extends ObjectLiteral>(
  manager: EntityManager,
  entidad: EntityTarget<T>,
  id: number,
  nuevo: Estado,
  condicion: { igualA?: number; distintoDe?: number; extra?: object },
): Promise<boolean> {
  const consulta = manager
    .createQueryBuilder()
    .update(entidad)
    .set({ estado: { id: nuevo.id }, ...condicion.extra } as never)
    .where('Id = :id', { id });
  if (condicion.igualA !== undefined) {
    consulta.andWhere('EstadoId = :igualA', { igualA: condicion.igualA });
  }
  if (condicion.distintoDe !== undefined) {
    consulta.andWhere('(EstadoId IS NULL OR EstadoId <> :distintoDe)', {
      distintoDe: condicion.distintoDe,
    });
  }
  const { affected } = await consulta.execute();
  return (affected ?? 0) > 0;
}

/** Flow informa la fecha como "AAAA-MM-DD HH:mm:ss". Si no se puede leer, se usa ahora. */
export function fechaDeFlow(valor: string | null | undefined): Date {
  const fecha = valor ? new Date(valor.replace(' ', 'T')) : new Date(NaN);
  return Number.isNaN(fecha.getTime()) ? new Date() : fecha;
}
