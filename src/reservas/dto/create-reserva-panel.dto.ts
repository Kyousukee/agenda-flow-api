import {
  IsEmail,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * SPEC 08: POST /reservas (panel). Mismos formatos que CreateReservaDto, pero sin
 * `empresaId` (sale del JWT) ni `pagarAhora` (la reserva del panel no cobra abono),
 * y con `empleadoId` obligatorio.
 */
export class CreateReservaPanelDto {
  @IsInt()
  @Min(1)
  sucursalId: number;

  @IsInt()
  @Min(1)
  servicioId: number;

  @IsInt()
  @Min(1)
  empleadoId: number;

  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener formato AAAA-MM-DD',
  })
  fecha: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'horaInicio debe tener formato HH:mm',
  })
  horaInicio: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacion?: string;
}
