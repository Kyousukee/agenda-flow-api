import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Horario } from '../horarios/entities/horario.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { Bloqueo } from '../bloqueos/entities/bloqueo.entity';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';
import { CreacionReservaService } from './creacion-reserva.service';
import { AuthModule } from '../auth/auth.module';
import { CorreosModule } from '../correos/correos.module';
import { PagosModule } from '../pagos/pagos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reserva,
      Estado,
      Sucursal,
      Servicio,
      Empleado,
      Horario,
      ServicioEmpleado,
      Bloqueo,
    ]),
    AuthModule,
    CorreosModule,
    PagosModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService, CreacionReservaService],
  // SPEC 08: la reserva pública (ReservarModule) usa la misma creación.
  exports: [CreacionReservaService],
})
export class ReservasModule {}
