import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('Rol')
export class Rol {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 100, name: 'Nombre' })
  nombre: string;

  @Column({
    type: 'nvarchar',
    length: 300,
    nullable: true,
    name: 'Descripcion',
  })
  descripcion?: string;

  @Column({ type: 'bit', default: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;
}
