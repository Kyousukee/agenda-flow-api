import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sucursal } from '../../sucursales/entities/sucursal.entity';

@Entity('horarios')
export class Horario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', name: 'dia_semana' })
  diaSemana: number;

  @Column({ type: 'time', name: 'hora_inicio' })
  horaInicio: string;

  @Column({ type: 'time', name: 'hora_fin' })
  horaFin: string;

  @Column({ type: 'bit', name: 'abierto', default: true })
  abierto: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'created_at' })
  fechaCreacion: Date;

  @UpdateDateColumn({
    type: 'datetime2',
    name: 'updated_at',
    nullable: true,
  })
  fechaActualizacion: Date;

  @ManyToOne(() => Sucursal, (sucursal) => sucursal.horarios)
  @JoinColumn({ name: 'sucursal_id' })
  sucursal: Sucursal;
}
