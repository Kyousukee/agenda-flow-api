import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';
import { Rol } from '../../rol/entities/rol.entity';
import { Estado } from '../../reservas/entities/estado.entity';
import { Sucursal } from '../../sucursales/entities/sucursal.entity';

@Entity('Usuario')
export class Usuario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 100, name: 'Nombre' })
  nombre: string;

  @Column({ type: 'nvarchar', length: 100, nullable: true, name: 'Apellido' })
  apellido?: string;

  @Column({ type: 'nvarchar', length: 150, unique: true, name: 'Email' })
  email: string;

  /** NULL en las cuentas creadas con Google (SPEC 05) hasta que creen una contraseña. */
  @Column({
    type: 'nvarchar',
    length: 'max',
    nullable: true,
    name: 'PasswordHash',
  })
  passwordHash: string | null;

  /** El "sub" del ID token de Google. No se selecciona por defecto. */
  @Column({
    type: 'nvarchar',
    length: 255,
    nullable: true,
    select: false,
    name: 'GoogleId',
  })
  googleId?: string | null;

  @Column({ type: 'nvarchar', length: 20, nullable: true, name: 'Telefono' })
  telefono?: string;

  @Column({ type: 'bit', default: true, name: 'Activo' })
  activo: boolean;

  @Column({ type: 'bit', default: false, name: 'EmailVerificado' })
  emailVerificado: boolean;

  /** Va en el JWT; sube en 1 al restablecer la contraseña y cierra las sesiones. */
  @Column({ type: 'int', default: 0, name: 'TokenVersion' })
  tokenVersion: number;

  // SPEC 04: solo se guarda el hash del token. No se selecciona por defecto.
  @Column({
    type: 'nvarchar',
    length: 64,
    nullable: true,
    select: false,
    name: 'VerificacionTokenHash',
  })
  verificacionTokenHash?: string | null;

  @Column({ type: 'datetime2', nullable: true, name: 'VerificacionExpira' })
  verificacionExpira?: Date | null;

  @Column({
    type: 'datetime2',
    nullable: true,
    name: 'VerificacionUltimoEnvio',
  })
  verificacionUltimoEnvio?: Date | null;

  @Column({
    type: 'datetime2',
    nullable: true,
    name: 'VerificacionVentanaInicio',
  })
  verificacionVentanaInicio?: Date | null;

  @Column({ type: 'int', default: 0, name: 'VerificacionEnviosVentana' })
  verificacionEnviosVentana: number;

  @Column({
    type: 'nvarchar',
    length: 64,
    nullable: true,
    select: false,
    name: 'ResetTokenHash',
  })
  resetTokenHash?: string | null;

  @Column({ type: 'datetime2', nullable: true, name: 'ResetExpira' })
  resetExpira?: Date | null;

  @Column({ type: 'datetime2', nullable: true, name: 'ResetUltimoEnvio' })
  resetUltimoEnvio?: Date | null;

  @Column({ type: 'datetime2', nullable: true, name: 'ResetVentanaInicio' })
  resetVentanaInicio?: Date | null;

  @Column({ type: 'int', default: 0, name: 'ResetEnviosVentana' })
  resetEnviosVentana: number;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({
    type: 'datetime2',
    name: 'FechaActualizacion',
    nullable: true,
  })
  fechaActualizacion: Date;

  @ManyToOne(() => Empresa)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;

  @ManyToOne(() => Rol)
  @JoinColumn({ name: 'RolId' })
  rol: Rol;

  @ManyToOne(() => Estado)
  @JoinColumn({ name: 'EstadoId' })
  estado: Estado;

  /** SPEC 08: sucursal del recepcionista. NULL en el rol 1. */
  @ManyToOne(() => Sucursal, { nullable: true })
  @JoinColumn({ name: 'SucursalId' })
  sucursal?: Sucursal | null;

  /** SPEC 08: recepcionista desactivado por el excedente del plan Gratis (SPEC 01). */
  @Column({ type: 'bit', default: false, name: 'DesactivadoPorSuscripcion' })
  desactivadoPorSuscripcion: boolean;
}
