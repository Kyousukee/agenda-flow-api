import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sucursal } from './entities/sucursal.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { SucursalesController } from './sucursales.controller';
import { SucursalesService } from './sucursales.service';
import { AuthModule } from '../auth/auth.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sucursal, Empresa]),
    AuthModule,
    SuscripcionesModule,
  ],
  controllers: [SucursalesController],
  providers: [SucursalesService],
})
export class SucursalesModule {}
