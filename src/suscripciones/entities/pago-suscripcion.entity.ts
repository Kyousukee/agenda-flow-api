import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Estado } from '../../reservas/entities/estado.entity';

/** Pago de la mensualidad Pro con Flow (SPEC 06). */
@Entity('PagoSuscripcion')
export class PagoSuscripcion {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'int', name: 'EmpresaId' })
  empresaId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'Monto' })
  monto: number;

  @Column({ type: 'int', name: 'Dias' })
  dias: number;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'FlowToken' })
  flowToken: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'FlowOrder' })
  flowOrder: string | null;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @Column({ type: 'datetime2', nullable: true, name: 'FechaPago' })
  fechaPago: Date | null;

  /** FechaFin de la suscripción antes de extender (auditoría). */
  @Column({ type: 'datetime2', nullable: true, name: 'FinAnterior' })
  finAnterior: Date | null;

  /** FechaFin de la suscripción después de extender. */
  @Column({ type: 'datetime2', nullable: true, name: 'FinNuevo' })
  finNuevo: Date | null;
}
