import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { PagoSuscripcion } from './entities/pago-suscripcion.entity';
import { SuscripcionesService } from './suscripciones.service';
import { SuscripcionesController } from './suscripciones.controller';
import { AuthModule } from '../auth/auth.module';
import { Estado } from '../reservas/entities/estado.entity';
import { FlowModule } from '../flow/flow.module';
import { PagosSuscripcionService } from './pagos-suscripcion.service';
import { SuscripcionFlowController } from './suscripcion-flow.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Suscripcion, PagoSuscripcion, Estado]),
    AuthModule,
    FlowModule,
  ],
  controllers: [SuscripcionesController, SuscripcionFlowController],
  providers: [SuscripcionesService, PagosSuscripcionService],
  exports: [SuscripcionesService],
})
export class SuscripcionesModule {}
