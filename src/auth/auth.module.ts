import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CuentaService } from './cuenta.service';
import { GoogleAuthService } from './google-auth.service';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Rol } from '../rol/entities/rol.entity';
import { CorreosModule } from '../correos/correos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Empresa, Sucursal, Empleado, Rol]),
    CorreosModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        // Sin secreto los tokens no serían confiables: mejor no arrancar.
        if (!secret?.trim()) {
          throw new Error('JWT_SECRET no está configurado');
        }
        // Las variables de .env llegan como string. jsonwebtoken interpreta un string
        // numérico sin unidad como MILISEGUNDOS ("86400" = 86 s), así que se convierte
        // a número (segundos). También acepta formatos con unidad: "7d", "12h".
        const raw = String(config.get('JWT_EXPIRATION') ?? '7d').trim();
        const expiresIn = /^\d+$/.test(raw) ? Number(raw) : raw;
        return {
          secret,
          signOptions: { expiresIn: expiresIn as any },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CuentaService, GoogleAuthService],
  // TypeOrmModule: JwtAuthGuard se resuelve en cada módulo que importa AuthModule
  // y necesita el repositorio de Usuario.
  // SPEC 08: CuentaService lo usa la gestión del equipo para las invitaciones.
  exports: [AuthService, CuentaService, JwtModule, TypeOrmModule],
})
export class AuthModule {}
