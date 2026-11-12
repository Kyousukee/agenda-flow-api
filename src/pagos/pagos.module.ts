import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './entities/pago.entity';
import { Reembolso } from './entities/reembolso.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { FlowModule } from '../flow/flow.module';
import { AbonosService } from './abonos.service';
import { ReembolsosService } from './reembolsos.service';
import { PagosFlowController } from './pagos-flow.controller';
import { CorreosModule } from '../correos/correos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Pago,
      Reembolso,
      Reserva,
      Estado,
      Sucursal,
      ConfiguracionEmpresa,
    ]),
    AuthModule,
    SuscripcionesModule,
    FlowModule,
    CorreosModule,
  ],
  controllers: [PagosController, PagosFlowController],
  providers: [PagosService, AbonosService, ReembolsosService],
  exports: [AbonosService, ReembolsosService],
})
export class PagosModule {}
