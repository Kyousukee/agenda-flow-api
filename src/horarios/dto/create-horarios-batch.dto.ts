import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateHorarioDto } from './create-horario.dto';

export class CreateHorariosBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHorarioDto)
  horarios: CreateHorarioDto[];
}
