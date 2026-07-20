import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Reserva } from '../../reservas/entities/reserva.entity';

@Entity('pagos')
export class Pago {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Monto' })
  monto: number;

  @Column({ type: 'nvarchar', length: 50, nullable: true, name: 'MetodoPago' })
  metodoPago?: string;

  @Column({ type: 'datetime2', name: 'FechaPago' })
  fechaPago: Date;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @ManyToOne(() => Reserva, (reserva) => reserva.pagos)
  @JoinColumn({ name: 'ReservaId' })
  reserva: Reserva;
}
