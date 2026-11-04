import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empleado } from './entities/empleado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { EmpleadosController } from './empleados.controller';
import { EmpleadosService } from './empleados.service';
import { AuthModule } from '../auth/auth.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Empleado, Sucursal, ServicioEmpleado]),
    AuthModule,
    SuscripcionesModule,
  ],
  controllers: [EmpleadosController],
  providers: [EmpleadosService],
})
export class EmpleadosModule {}
