import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'mssql',
  host: configService.get<string>('DB_HOST'),
  // Las variables de entorno llegan como string; tedious exige un number.
  port: Number(configService.get<string>('DB_PORT') || 1433),
  username: configService.get<string>('DB_USER'),
  password: configService.get<string>('DB_PASS'),
  database: configService.get<string>('DB_NAME'),
  autoLoadEntities: true,
  synchronize: false,
  options: {
    // Instancia con nombre (ej. SQLEXPRESS). Requiere el servicio "SQL Server Browser"
    // activo; si se define, el puerto lo resuelve el Browser y DB_PORT se ignora.
    instanceName: configService.get<string>('DB_INSTANCE') || undefined,
    encrypt: false,
    trustServerCertificate: true,
  },
});
