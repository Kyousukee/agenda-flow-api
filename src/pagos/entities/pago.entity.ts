import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Reserva } from '../../reservas/entities/reserva.entity';
import { Estado } from '../../reservas/entities/estado.entity';

@Entity('Pago')
export class Pago {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'int', name: 'ReservaId' })
  reserva_id: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Monto' })
  monto: number;

  @Column({ type: 'nvarchar', length: 50, nullable: true, name: 'MetodoPago' })
  metodoPago?: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'CodigoTransaccion' })
  codigoTransaccion?: string;

  @Column({ type: 'datetime2', name: 'FechaPago' })
  fechaPago: Date;

  @ManyToOne(() => Reserva, (reserva) => reserva.pagos)
  @JoinColumn({ name: 'ReservaId' })
  reserva: Reserva;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;
}
