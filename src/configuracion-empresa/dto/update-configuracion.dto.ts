import { IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';
import { TIPOS_ANTICIPO } from '../../pagos/abonos';
import type { TipoAnticipo } from '../../pagos/abonos';

export class UpdateConfiguracionDto {
  @IsOptional()
  @IsBoolean()
  permitePagoAnticipado?: boolean;

  /** SPEC 06: si es false, el cliente elige pagar ahora o en el local. */
  @IsOptional()
  @IsBoolean()
  pagoObligatorio?: boolean;

  @IsOptional()
  @IsIn(TIPOS_ANTICIPO)
  tipoAnticipo?: TipoAnticipo | null;

  @IsOptional()
  @IsNumber()
  montoAnticipo?: number;

  @IsOptional()
  @IsNumber()
  tiempoCancelacionHoras?: number;

  @IsOptional()
  @IsNumber()
  tiempoReservaMinutos?: number;

  @IsOptional()
  @IsBoolean()
  permiteSeleccionEmpleado?: boolean;

  @IsOptional()
  @IsBoolean()
  mostrarPrecios?: boolean;

  @IsOptional()
  @IsBoolean()
  enviarCorreo?: boolean;

  @IsOptional()
  @IsBoolean()
  enviarWhatsapp?: boolean;
}
