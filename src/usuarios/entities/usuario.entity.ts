import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';
import { Rol } from '../../rol/entities/rol.entity';
import { Estado } from '../../reservas/entities/estado.entity';

@Entity('Usuario')
export class Usuario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 100, name: 'Nombre' })
  nombre: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Apellido' })
  apellido?: string;

  @Column({ type: 'nvarchar', length: 150, unique: true, name: 'Email' })
  email: string;

  @Column({ type: 'nvarchar', length: 'max', name: 'PasswordHash' })
  passwordHash: string;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @Column({ type: 'bit', default: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({
    type: 'datetime2',
    name: 'FechaActualizacion',
    nullable: true,
  })
  fechaActualizacion: Date;

  @ManyToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @ManyToOne(() => Rol)
  @JoinColumn({ name: 'RolId' })
  rol: Rol;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;
}
