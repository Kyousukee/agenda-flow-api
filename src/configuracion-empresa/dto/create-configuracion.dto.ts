import { IsString, IsOptional, IsNumber, IsBoolean, MaxLength } from 'class-validator';

export class CreateConfiguracionDto {
  @IsOptional()
  @IsBoolean()
  permitePagoAnticipado?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tipoAnticipo?: string;

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
