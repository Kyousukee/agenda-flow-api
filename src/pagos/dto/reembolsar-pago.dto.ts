import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/** SPEC 07: POST /pagos/:id/reembolso. */
export class ReembolsarPagoDto {
  /** Pesos enteros. Si se omite, se reembolsa todo el reembolsable. El tope se valida en el servicio. */
  @IsOptional()
  @IsInt()
  @Min(1)
  monto?: number;

  /** Si es true, la reserva pasa a Cancelada cuando Flow acepta el reembolso. */
  @IsOptional()
  @IsBoolean()
  cancelarReserva?: boolean;
}
