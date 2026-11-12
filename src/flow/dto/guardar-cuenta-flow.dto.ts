import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Credenciales de Flow → Mis datos → Integración. */
export class GuardarCuentaFlowDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  apiKey: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  secretKey: string;
}
