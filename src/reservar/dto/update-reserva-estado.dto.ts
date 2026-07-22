import { IsNumber } from 'class-validator';

export class UpdateReservaEstadoDto {
  @IsNumber()
  estadoId: number;
}
