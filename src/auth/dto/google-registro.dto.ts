import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DatosNegocioDto } from './register.dto';

/**
 * SPEC 05: el email y la identidad salen del ID token, nunca del cuerpo.
 * Nombre y apellido son opcionales: por defecto se usan los de Google.
 */
export class GoogleRegistroDto extends DatosNegocioDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  credential: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;
}
