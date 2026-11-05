import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracionEmpresa } from './entities/configuracion-empresa.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { ConfiguracionEmpresaController } from './configuracion-empresa.controller';
import { ConfiguracionEmpresaService } from './configuracion-empresa.service';
import { AuthModule } from '../auth/auth.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConfiguracionEmpresa, Empresa]),
    AuthModule,
    CloudinaryModule,
  ],
  controllers: [ConfiguracionEmpresaController],
  providers: [ConfiguracionEmpresaService],
})
export class ConfiguracionEmpresaModule {}
