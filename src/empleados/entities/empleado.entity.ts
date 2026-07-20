import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Sucursal } from '../../sucursales/entities/sucursal.entity';
import { Bloqueo } from '../../bloqueos/entities/bloqueo.entity';
import { Reserva } from '../../reservas/entities/reserva.entity';
import { ServicioEmpleado } from '../../servicios-empleados/entities/servicio-empleado.entity';

@Entity('Empleado')
export class Empleado {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Nombre' })
  nombre?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Apellido' })
  apellido?: string;

  @Column({ type: 'nvarchar', length: 150, nullable: true, name: 'Email' })
  email?: string;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @Column({ type: 'nvarchar', length: 300, nullable: true, name: 'Foto' })
  foto?: string;

  @Column({
    type: 'nvarchar',
    length: 500,
    nullable: true,
    name: 'Descripcion',
  })
  descripcion?: string;

  @Column({ type: 'bit', default: true, nullable: true, name: 'Activo' })
  activo: boolean;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Sucursal, (sucursal) => sucursal.empleados)
  @JoinColumn({ name: 'SucursalId' })
  sucursal: Sucursal;

  @OneToMany(() => Bloqueo, (bloqueo) => bloqueo.empleado)
  bloqueos: Bloqueo[];

  @OneToMany(() => Reserva, (reserva) => reserva.empleado)
  reservas: Reserva[];

  @OneToMany(() => ServicioEmpleado, (se) => se.empleado)
  serviciosEmpleados: ServicioEmpleado[];
}
