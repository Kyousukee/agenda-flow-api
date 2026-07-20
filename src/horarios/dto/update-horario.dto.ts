import {
  IsNumber,
  IsString,
  IsBoolean,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class UpdateHorarioDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  diaSemana?: number;

  @IsOptional()
  @IsString()
  horaInicio?: string;

  @IsOptional()
  @IsString()
  horaFin?: string;

  @IsOptional()
  @IsBoolean()
  abierto?: boolean;
}
