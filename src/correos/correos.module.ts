import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reserva } from '../reservas/entities/reserva.entity';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { CorreosService } from './correos.service';
import { ReservaCorreosService } from './reserva-correos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reserva, ConfiguracionEmpresa, Usuario])],
  providers: [CorreosService, ReservaCorreosService],
  exports: [CorreosService, ReservaCorreosService],
})
export class CorreosModule {}
