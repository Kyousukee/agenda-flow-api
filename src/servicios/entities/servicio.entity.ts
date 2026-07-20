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
import { Reserva } from '../../reservas/entities/reserva.entity';
import { ServicioEmpleado } from '../../servicios-empleados/entities/servicio-empleado.entity';

@Entity('Servicio')
export class Servicio {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 255, name: 'Nombre' })
  nombre: string;

  @Column({ type: 'text', nullable: true, name: 'Descripcion' })
  descripcion?: string;

  @Column({ type: 'int', name: 'DuracionMinutos' })
  duracionMinutos: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Precio' })
  precio: number;

  @Column({ type: 'nvarchar', length: 7, nullable: true, name: 'Color' })
  color?: string;

  @Column({ type: 'bit', default: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Empresa, (empresa) => empresa.servicios)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @OneToMany(() => Reserva, (reserva) => reserva.servicio)
  reservas: Reserva[];

  @OneToMany(() => ServicioEmpleado, (se) => se.servicio)
  serviciosEmpleados: ServicioEmpleado[];
}
