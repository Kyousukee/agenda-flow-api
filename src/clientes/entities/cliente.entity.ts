import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';

@Entity('Cliente')
export class Cliente {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Nombre' })
  nombre?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Apellido' })
  apellido?: string;

  @Column({ type: 'nvarchar', length: 150, name: 'Email' })
  email: string;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;
}
