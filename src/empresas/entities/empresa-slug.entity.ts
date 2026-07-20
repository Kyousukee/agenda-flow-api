import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';

@Entity('EmpresaSlug')
export class EmpresaSlug {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 100, name: 'Slug' })
  slug: string;

  @ManyToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;
}
