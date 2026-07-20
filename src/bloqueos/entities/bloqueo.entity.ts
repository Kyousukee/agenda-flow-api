import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Empleado } from '../../empleados/entities/empleado.entity';

@Entity('BloqueoAgenda')
export class Bloqueo {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'date', name: 'Fecha' })
  fecha: string;

  @Column({ type: 'time', name: 'HoraInicio' })
  horaInicio: string;

  @Column({ type: 'time', name: 'HoraFin' })
  horaFin: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true, name: 'Motivo' })
  motivo?: string;

  @ManyToOne(() => Empleado, (empleado) => empleado.bloqueos, {
    nullable: true,
  })
  @JoinColumn({ name: 'EmpleadoId' })
  empleado: Empleado;
}
