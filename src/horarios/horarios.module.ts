import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Horario } from './entities/horario.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { HorariosService } from './horarios.service';
import { HorariosController } from './horarios.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Horario, Sucursal]), AuthModule],
  controllers: [HorariosController],
  providers: [HorariosService],
})
export class HorariosModule {}
