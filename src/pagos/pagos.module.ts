import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago, Reserva, Estado]),
    AuthModule,
  ],
  controllers: [PagosController],
  providers: [PagosService],
})
export class PagosModule {}
