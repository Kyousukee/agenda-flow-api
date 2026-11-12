import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Credenciales Flow de un local (SPEC 06).
 * `sucursalId = null` es la cuenta de la empresa; con valor, la cuenta propia de esa sucursal.
 */
@Entity('CuentaFlow')
export class CuentaFlow {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'int', name: 'EmpresaId' })
  empresaId: number;

  @Column({ type: 'int', nullable: true, name: 'SucursalId' })
  sucursalId: number | null;

  @Column({ type: 'nvarchar', length: 100, name: 'ApiKey' })
  apiKey: string;

  /** base64(iv | authTag | cifrado). Nunca sale de la API. */
  @Column({ type: 'nvarchar', length: 500, name: 'SecretKeyCifrada' })
  secretKeyCifrada: string;

  @CreateDateColumn({ type: 'datetime2', name: 'FechaCreacion' })
  fechaCreacion: Date;

  @Column({ type: 'datetime2', nullable: true, name: 'FechaActualizacion' })
  fechaActualizacion: Date | null;

  /** Baja lógica. Una cuenta dada de baja no se usa para cobrar, pero sí para verificar sus pagos. */
  @Column({ type: 'datetime2', nullable: true, name: 'FechaBaja' })
  fechaBaja: Date | null;
}
