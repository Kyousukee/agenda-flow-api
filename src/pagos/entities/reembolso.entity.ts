import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Estado } from '../../reservas/entities/estado.entity';
import { Pago } from './pago.entity';

export type OrigenReembolso = 'Cliente' | 'Panel';

/**
 * SPEC 07: reembolso de un abono cobrado con Flow. Un pago puede tener varios
 * (parciales). Usa los estados de tipo 'Pago': Pendiente, Reembolsado o Rechazado.
 */
@Entity('Reembolso')
export class Reembolso {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'int', name: 'PagoId' })
  pagoId: number;

  @ManyToOne(() => Pago, (pago) => pago.reembolsos)
  @JoinColumn({ name: 'PagoId' })
  pago: Pago;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Monto' })
  monto: number;

  @Column({ type: 'nvarchar', length: 10, name: 'Origen' })
  origen: OrigenReembolso;

  /** Usuario del panel que lo pidió. NULL si lo pidió el cliente. */
  @Column({ type: 'int', nullable: true, name: 'UsuarioId' })
  usuarioId: number | null;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'FlowToken' })
  flowToken: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'FlowRefundOrder' })
  flowRefundOrder: string | null;

  /** `fee` que informa Flow por el reembolso. */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    name: 'ComisionFlow',
  })
  comisionFlow: number | null;

  /** Mensaje de Flow si se rechazó. */
  @Column({ type: 'nvarchar', length: 500, nullable: true, name: 'Error' })
  error: string | null;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @Column({ type: 'datetime2', nullable: true, name: 'FechaResolucion' })
  fechaResolucion: Date | null;
}
