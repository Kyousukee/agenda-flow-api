import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Sucursal } from '../../sucursales/entities/sucursal.entity';
import { Servicio } from '../../servicios/entities/servicio.entity';
import { ConfiguracionEmpresa } from '../../configuracion-empresa/entities/configuracion-empresa.entity';
import { Estado } from '../../reservas/entities/estado.entity';

@Entity('Empresa')
export class Empresa {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'nvarchar', length: 150, name: 'Nombre' })
  nombre: string;

  @Column({
    type: 'nvarchar',
    length: 150,
    nullable: true,
    name: 'NombreComercial',
  })
  nombreComercial?: string;

  @Column({ type: 'nvarchar', length: 100, unique: true, name: 'Slug' })
  slug: string;

  @Column({
    type: 'nvarchar',
    length: 500,
    nullable: true,
    name: 'Descripcion',
  })
  descripcion?: string;

  @Column({ type: 'nvarchar', length: 150, nullable: true, name: 'Email' })
  email?: string;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Whatsapp' })
  whatsapp?: string;

  @Column({ type: 'nvarchar', length: 200, nullable: true, name: 'SitioWeb' })
  sitioWeb?: string;

  @Column({ type: 'nvarchar', length: 300, nullable: true, name: 'Logo' })
  logo?: string;

  @Column({ type: 'nvarchar', length: 300, nullable: true, name: 'Banner' })
  banner?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    name: 'ColorPrincipal',
  })
  colorPrincipal?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    name: 'ColorSecundario',
  })
  colorSecundario?: string;

  @Column({ type: 'int', name: 'EstadoId' })
  estadoId: number;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({
    type: 'datetime2',
    name: 'FechaActualizacion',
    nullable: true,
  })
  fechaActualizacion: Date;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;

  @OneToMany(() => Sucursal, (sucursal) => sucursal.empresa)
  sucursales: Sucursal[];

  @OneToMany(() => Servicio, (servicio) => servicio.empresa)
  servicios: Servicio[];

  @OneToMany(() => ConfiguracionEmpresa, (config) => config.empresa)
  configuracion: ConfiguracionEmpresa;
}
