import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServicioEmpleado } from './entities/servicio-empleado.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServicioEmpleado])],
})
export class ServiciosEmpleadosModule {}
