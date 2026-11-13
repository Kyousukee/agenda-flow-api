import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** SPEC 08: POST /equipo — invita a un recepcionista a una sucursal. */
export class CreateMiembroEquipoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsEmail()
  @MaxLength(150)
  email: string;

  @IsInt()
  @Min(1)
  sucursalId: number;
}
