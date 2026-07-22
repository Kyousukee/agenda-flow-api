import { IsNumber } from 'class-validator';

export class UpdatePagoEstadoDto {
  @IsNumber()
  estadoId: number;
}
