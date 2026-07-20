import { DataSource } from 'typeorm';
import { Estado } from '../../reservas/entities/estado.entity';

const ESTADOS_RESERVA = [
  { tipo: 'Reserva', nombre: 'Programada', color: '#3498db', orden: 1 },
  { tipo: 'Reserva', nombre: 'Completada', color: '#2ecc71', orden: 2 },
  { tipo: 'Reserva', nombre: 'Pagado', color: '#27ae60', orden: 3 },
  { tipo: 'Reserva', nombre: 'Pendiente', color: '#f39c12', orden: 4 },
  { tipo: 'Reserva', nombre: 'Cancelada', color: '#e74c3c', orden: 5 },
  { tipo: 'Reserva', nombre: 'Rechazado', color: '#c0392b', orden: 6 },
  { tipo: 'Reserva', nombre: 'Anulado', color: '#95a5a6', orden: 7 },
];

const ESTADOS_USUARIO = [
  { tipo: 'Usuario', nombre: 'Activo', color: '#2ecc71', orden: 1 },
  { tipo: 'Usuario', nombre: 'Inactivo', color: '#e74c3c', orden: 2 },
  { tipo: 'Usuario', nombre: 'Pendiente', color: '#f39c12', orden: 3 },
];

const ESTADOS_EMPRESA = [
  { tipo: 'Empresa', nombre: 'Activa', color: '#2ecc71', orden: 1 },
  { tipo: 'Empresa', nombre: 'Inactiva', color: '#e74c3c', orden: 2 },
  { tipo: 'Empresa', nombre: 'Suspendida', color: '#f39c12', orden: 3 },
];

export async function seedEstados(dataSource: DataSource): Promise<void> {
  const repository = dataSource.getRepository(Estado);
  const allEstados = [
    ...ESTADOS_RESERVA,
    ...ESTADOS_USUARIO,
    ...ESTADOS_EMPRESA,
  ];

  for (const estado of allEstados) {
    const exists = await repository.findOne({
      where: { tipo: estado.tipo, nombre: estado.nombre },
    });
    if (!exists) {
      await repository.save(
        repository.create({
          ...estado,
          activo: true,
          fechaCreacion: new Date(),
        }),
      );
    }
  }
}
