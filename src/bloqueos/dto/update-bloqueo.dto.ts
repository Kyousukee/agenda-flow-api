import { IsString, IsOptional, IsNumber, MaxLength } from 'class-validator';

export class UpdateBloqueoDto {
  @IsOptional()
  @IsNumber()
  empleadoId?: number;

  @IsOptional()
  @IsString()
  fecha?: string;

  @IsOptional()
  @IsString()
  horaInicio?: string;

  @IsOptional()
  @IsString()
  horaFin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motivo?: string;
}
