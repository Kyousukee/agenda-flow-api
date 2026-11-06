import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { getDatabaseConfig } from './config/database.config';
import { EmpresasModule } from './empresas/empresas.module';
import { SucursalesModule } from './sucursales/sucursales.module';
import { EmpleadosModule } from './empleados/empleados.module';
import { ServiciosModule } from './servicios/servicios.module';
import { ServiciosEmpleadosModule } from './servicios-empleados/servicios-empleados.module';
import { HorariosModule } from './horarios/horarios.module';
import { BloqueosModule } from './bloqueos/bloqueos.module';
import { ReservasModule } from './reservas/reservas.module';
import { PagosModule } from './pagos/pagos.module';
import { ConfiguracionEmpresaModule } from './configuracion-empresa/configuracion-empresa.module';
import { ReservarModule } from './reservar/reservar.module';
import { AuthModule } from './auth/auth.module';
import { SuscripcionesModule } from './suscripciones/suscripciones.module';
import { CorreosModule } from './correos/correos.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Límite general por IP; login, registro y reservas tienen uno más estricto.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDatabaseConfig(configService),
    }),
    AuthModule,
    EmpresasModule,
    SucursalesModule,
    EmpleadosModule,
    ServiciosModule,
    ServiciosEmpleadosModule,
    HorariosModule,
    BloqueosModule,
    ReservasModule,
    PagosModule,
    ConfiguracionEmpresaModule,
    ReservarModule,
    SuscripcionesModule,
    CorreosModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
