import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Matches, Min } from 'class-validator';

/** SPEC 08: query de GET /reservas/proxima-hora. */
export class ProximaHoraQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sucursalId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId: number;

  /** Por defecto, hoy en America/Santiago. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener formato AAAA-MM-DD',
  })
  fecha?: string;
}
