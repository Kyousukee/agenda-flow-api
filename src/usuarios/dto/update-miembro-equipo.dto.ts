import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** SPEC 08: PATCH /equipo/:id. Cambiar la sucursal o desactivar cierra la sesión. */
export class UpdateMiembroEquipoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sucursalId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
