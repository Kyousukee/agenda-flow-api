import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';

export type PlanSuscripcion = 'Prueba' | 'Gratis' | 'Pro';

@Entity('Suscripcion')
export class Suscripcion {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'int', name: 'EmpresaId', unique: true })
  empresaId: number;

  @OneToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @Column({ type: 'nvarchar', length: 20, name: 'Plan' })
  plan: PlanSuscripcion;

  @Column({ type: 'datetime2', name: 'FechaInicio' })
  fechaInicio: Date;

  // NULL + Pro = sin vencimiento; NULL + Gratis = indefinido
  @Column({ type: 'datetime2', nullable: true, name: 'FechaFin' })
  fechaFin: Date | null;

  @Column({ type: 'bit', default: false, name: 'ExcedenteDesactivado' })
  excedenteDesactivado: boolean;

  @UpdateDateColumn({ type: 'datetime2', nullable: true, name: 'FechaActualizacion' })
  fechaActualizacion: Date;
}
