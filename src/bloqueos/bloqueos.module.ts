import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bloqueo } from './entities/bloqueo.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { BloqueosController } from './bloqueos.controller';
import { BloqueosService } from './bloqueos.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bloqueo, Empleado]), AuthModule],
  controllers: [BloqueosController],
  providers: [BloqueosService],
})
export class BloqueosModule {}
