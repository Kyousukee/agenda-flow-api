import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from './entities/usuario.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { AuthModule } from '../auth/auth.module';
import { CorreosModule } from '../correos/correos.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { EquipoController } from './equipo.controller';
import { EquipoService } from './equipo.service';

/** SPEC 08: gestión del equipo (recepcionistas). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Sucursal, Empresa, Estado]),
    AuthModule,
    CorreosModule,
    SuscripcionesModule,
  ],
  controllers: [EquipoController],
  providers: [EquipoService],
})
export class UsuariosModule {}
