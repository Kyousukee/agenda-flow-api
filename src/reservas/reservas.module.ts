import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';
import { AuthModule } from '../auth/auth.module';
import { CorreosModule } from '../correos/correos.module';
import { PagosModule } from '../pagos/pagos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reserva, Estado, Sucursal]),
    AuthModule,
    CorreosModule,
    PagosModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService],
})
export class ReservasModule {}
