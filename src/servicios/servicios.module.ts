import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Servicio } from './entities/servicio.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';
import { AuthModule } from '../auth/auth.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Servicio, Empresa]),
    AuthModule,
    SuscripcionesModule,
  ],
  controllers: [ServiciosController],
  providers: [ServiciosService],
})
export class ServiciosModule {}
