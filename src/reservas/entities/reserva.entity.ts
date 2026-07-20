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
import { Sucursal } from '../../sucursales/entities/sucursal.entity';
import { Empleado } from '../../empleados/entities/empleado.entity';
import { Servicio } from '../../servicios/entities/servicio.entity';
import { Cliente } from '../../clientes/entities/cliente.entity';
import { Estado } from './estado.entity';
import { Pago } from '../../pagos/entities/pago.entity';

@Entity('Reserva')
export class Reserva {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 50, name: 'Codigo' })
  codigo: string;

  @Column({ type: 'date', name: 'Fecha' })
  fecha: string;

  @Column({ type: 'time', name: 'HoraInicio' })
  horaInicio: string;

  @Column({ type: 'time', name: 'HoraFin' })
  horaFin: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Precio' })
  precio: number;

  @Column({ type: 'text', nullable: true, name: 'Observacion' })
  observacion?: string;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @ManyToOne(() => Sucursal, (sucursal) => sucursal.reservas)
  @JoinColumn({ name: 'SucursalId' })
  sucursal: Sucursal;

  @ManyToOne(() => Cliente)
  @JoinColumn({ name: 'ClienteId' })
  cliente: Cliente;

  @ManyToOne(() => Empleado, (empleado) => empleado.reservas)
  @JoinColumn({ name: 'EmpleadoId' })
  empleado: Empleado;

  @ManyToOne(() => Servicio, (servicio) => servicio.reservas)
  @JoinColumn({ name: 'ServicioId' })
  servicio: Servicio;

  @ManyToOne(() => Estado, (estado) => estado.reservas)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;

  @OneToMany(() => Pago, (pago) => pago.reserva)
  pagos: Pago[];
}
