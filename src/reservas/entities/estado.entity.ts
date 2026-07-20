import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Reserva } from './reserva.entity';

@Entity('Estado')
export class Estado {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'Tipo' })
  tipo?: string;

  @Column({ type: 'varchar', length: 50, name: 'Nombre' })
  nombre: string;

  @Column({
    type: 'nvarchar',
    length: 250,
    nullable: true,
    name: 'Descripcion',
  })
  descripcion?: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'Color' })
  color?: string;

  @Column({ type: 'int', nullable: true, name: 'Orden' })
  orden?: number;

  @Column({ type: 'bit', default: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @OneToMany(() => Reserva, (reserva) => reserva.estado)
  reservas: Reserva[];
}
