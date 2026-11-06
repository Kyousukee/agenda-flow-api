import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bloqueo } from './entities/bloqueo.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { BloqueosController } from './bloqueos.controller';
import { BloqueosService } from './bloqueos.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bloqueo, Empleado, Sucursal]), AuthModule],
  controllers: [BloqueosController],
  providers: [BloqueosService],
})
export class BloqueosModule {}
