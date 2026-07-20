import { IsNumber, IsString, IsBoolean, Min, Max } from 'class-validator';

export class CreateHorarioDto {
  @IsNumber()
  @Min(1)
  @Max(7)
  diaSemana: number;

  @IsString()
  horaInicio: string;

  @IsString()
  horaFin: string;

  @IsBoolean()
  abierto: boolean;
}
