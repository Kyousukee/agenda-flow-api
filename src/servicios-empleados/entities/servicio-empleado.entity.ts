import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Servicio } from '../../servicios/entities/servicio.entity';
import { Empleado } from '../../empleados/entities/empleado.entity';

@Entity('ServicioEmpleado')
export class ServicioEmpleado {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @ManyToOne(() => Servicio, (servicio) => servicio.serviciosEmpleados)
  @JoinColumn({ name: 'ServicioId' })
  servicio: Servicio;

  @ManyToOne(() => Empleado, (empleado) => empleado.serviciosEmpleados)
  @JoinColumn({ name: 'EmpleadoId' })
  empleado: Empleado;
}
