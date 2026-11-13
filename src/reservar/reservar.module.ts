import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReservarController } from './reservar.controller';
import { ReservarService } from './reservar.service';
import { CancelacionPublicaService } from './cancelacion-publica.service';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Cliente } from '../clientes/entities/cliente.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Horario } from '../horarios/entities/horario.entity';
import { Bloqueo } from '../bloqueos/entities/bloqueo.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { EmpresaSlug } from '../empresas/entities/empresa-slug.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { CorreosModule } from '../correos/correos.module';
import { PagosModule } from '../pagos/pagos.module';
import { ReservasModule } from '../reservas/reservas.module';
import { Pago } from '../pagos/entities/pago.entity';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reserva,
      Cliente,
      Sucursal,
      Servicio,
      Empleado,
      Horario,
      Bloqueo,
      ServicioEmpleado,
      Estado,
      EmpresaSlug,
      Empresa,
      Pago,
      ConfiguracionEmpresa,
    ]),
    SuscripcionesModule,
    CorreosModule,
    PagosModule,
    ReservasModule,
  ],
  controllers: [ReservarController],
  providers: [ReservarService, CancelacionPublicaService],
})
export class ReservarModule {}
