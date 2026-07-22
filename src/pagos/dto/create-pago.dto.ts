import { IsNumber, IsString, IsOptional, IsNotEmpty, IsDateString } from 'class-validator';

export class CreatePagoDto {
  @IsNumber()
  reservaId: number;

  @IsNumber()
  monto: number;

  @IsOptional()
  @IsString()
  metodoPago?: string;

  @IsOptional()
  @IsString()
  codigoTransaccion?: string;

  @IsDateString()
  fechaPago: string;

  @IsOptional()
  @IsNumber()
  estadoId?: number;
}
