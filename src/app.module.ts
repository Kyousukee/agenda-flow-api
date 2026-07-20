import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
