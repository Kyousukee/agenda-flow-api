import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CuentaFlow } from './entities/cuenta-flow.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { FlowClient } from './flow.client';
import { CifradoCredenciales } from './cifrado';
import { CuentasFlowService } from './cuentas-flow.service';
import { CuentasFlowController } from './cuentas-flow.controller';
import { AuthModule } from '../auth/auth.module';

/** SPEC 06: integración con Flow (cliente HTTP, cifrado y cuentas de los locales). */
@Module({
  imports: [TypeOrmModule.forFeature([CuentaFlow, Sucursal]), AuthModule],
  controllers: [CuentasFlowController],
  providers: [FlowClient, CifradoCredenciales, CuentasFlowService],
  exports: [FlowClient, CifradoCredenciales, CuentasFlowService],
})
export class FlowModule {}
