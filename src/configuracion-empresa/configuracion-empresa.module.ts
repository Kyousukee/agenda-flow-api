import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracionEmpresa } from './entities/configuracion-empresa.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { ConfiguracionEmpresaController } from './configuracion-empresa.controller';
import { ConfiguracionEmpresaService } from './configuracion-empresa.service';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { FlowModule } from '../flow/flow.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConfiguracionEmpresa, Empresa]),
    AuthModule,
    CloudinaryModule,
    SuscripcionesModule,
    FlowModule,
  ],
  controllers: [ConfiguracionEmpresaController],
  providers: [ConfiguracionEmpresaService],
})
export class ConfiguracionEmpresaModule {}
