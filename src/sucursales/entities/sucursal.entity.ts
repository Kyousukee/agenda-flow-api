import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';
import { Empleado } from '../../empleados/entities/empleado.entity';
import { Horario } from '../../horarios/entities/horario.entity';
import { Reserva } from '../../reservas/entities/reserva.entity';

@Entity('Sucursal')
export class Sucursal {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 150, nullable: true, name: 'Nombre' })
  nombre?: string;

  @Column({ type: 'nvarchar', length: 250, nullable: true, name: 'Direccion' })
  direccion?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Comuna' })
  comuna?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Ciudad' })
  ciudad?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Region' })
  region?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Pais' })
  pais?: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    name: 'Latitud',
  })
  latitud?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    name: 'Longitud',
  })
  longitud?: number;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @Column({ type: 'bit', default: true, nullable: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Empresa, (empresa) => empresa.sucursales)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @OneToMany(() => Empleado, (empleado) => empleado.sucursal)
  empleados: Empleado[];

  @OneToMany(() => Horario, (horario) => horario.sucursal)
  horarios: Horario[];

  @OneToMany(() => Reserva, (reserva) => reserva.sucursal)
  reservas: Reserva[];
}
