import {
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// El precio y la hora de término no se reciben: el servidor los calcula desde el servicio.
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

  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener formato AAAA-MM-DD',
  })
  fecha: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'horaInicio debe tener formato HH:mm',
  })
  horaInicio: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clienteNombre: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  clienteEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  clienteTelefono?: string;

  /** SPEC 06: solo se usa si la empresa tiene el pago opcional (PagoObligatorio = 0). */
  @IsOptional()
  @IsBoolean()
  pagarAhora?: boolean;
}
