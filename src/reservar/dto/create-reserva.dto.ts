import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

export class CreateReservaDto {
  @IsNumber()
  empresaId: number;

  @IsNumber()
  sucursalId: number;

  @IsNumber()
  servicioId: number;

  @IsOptional()
  @IsNumber()
  empleadoId?: number;

  @IsString()
  @IsNotEmpty()
  fecha: string;

  @IsString()
  @IsNotEmpty()
  horaInicio: string;

  @IsString()
  @IsNotEmpty()
  horaFin: string;

  @IsNumber()
  precio: number;

  @IsOptional()
  @IsString()
  observacion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clienteNombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clienteEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  clienteTelefono?: string;
}
