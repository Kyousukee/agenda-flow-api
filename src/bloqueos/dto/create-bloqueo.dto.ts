import { IsString, IsOptional, IsNumber, MaxLength } from 'class-validator';

export class CreateBloqueoDto {
  @IsNumber()
  empleadoId: number;

  @IsString()
  fecha: string;

  @IsString()
  horaInicio: string;

  @IsString()
  horaFin: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motivo?: string;
}
