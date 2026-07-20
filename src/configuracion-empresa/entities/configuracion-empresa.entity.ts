import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Empresa } from '../../empresas/entities/empresa.entity';

@Entity('ConfiguracionEmpresa')
export class ConfiguracionEmpresa {
  @PrimaryGeneratedColumn({ name: 'Id' })
  id: number;

  @Column({ type: 'bit', default: false, name: 'PermitePagoAnticipado' })
  permitePagoAnticipado: boolean;

  @Column({ type: 'nvarchar', length: 50, nullable: true, name: 'TipoAnticipo' })
  tipoAnticipo?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'MontoAnticipo' })
  montoAnticipo: number;

  @Column({ type: 'int', default: 24, name: 'TiempoCancelacionHoras' })
  tiempoCancelacionHoras: number;

  @Column({ type: 'int', default: 30, name: 'TiempoReservaMinutos' })
  tiempoReservaMinutos: number;

  @Column({ type: 'bit', default: true, name: 'PermiteSeleccionEmpleado' })
  permiteSeleccionEmpleado: boolean;

  @Column({ type: 'bit', default: true, name: 'MostrarPrecios' })
  mostrarPrecios: boolean;

  @Column({ type: 'bit', default: false, name: 'EnviarCorreo' })
  enviarCorreo: boolean;

  @Column({ type: 'bit', default: false, name: 'EnviarWhatsapp' })
  enviarWhatsapp: boolean;

  @OneToOne(() => Empresa, (empresa) => empresa.configuracion)
  @JoinColumn({ name: 'EmpresaId' })
  empresa: Empresa;
}
