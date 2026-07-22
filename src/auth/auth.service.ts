import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usuarioRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const slug = this.generateSlug(dto.empresaNombre);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const empresa = new Empresa();
      empresa.nombre = dto.empresaNombre;
      empresa.nombreComercial = dto.nombreComercial ?? undefined;
      empresa.slug = slug;
      empresa.email = dto.empresaEmail ?? undefined;
      empresa.telefono = dto.telefono ?? undefined;
      empresa.estadoId = 1;
      empresa.fechaCreacion = new Date();
      const savedEmpresa = await queryRunner.manager.save(empresa);

      const sucursal = new Sucursal();
      sucursal.empresa = savedEmpresa;
      sucursal.nombre = dto.sucursalNombre || 'Sucursal Principal';
      sucursal.direccion = dto.direccion ?? undefined;
      sucursal.comuna = dto.comuna ?? undefined;
      sucursal.ciudad = dto.ciudad ?? undefined;
      sucursal.region = dto.region ?? undefined;
      sucursal.pais = dto.pais || 'Chile';
      sucursal.latitud = dto.latitud ?? undefined;
      sucursal.longitud = dto.longitud ?? undefined;
      sucursal.telefono = dto.telefono ?? undefined;
      sucursal.activo = true;
      sucursal.fechaCreacion = new Date();
      const savedSucursal = await queryRunner.manager.save(sucursal);

      const usuario = new Usuario();
      usuario.empresa = savedEmpresa;
      usuario.nombre = dto.nombre;
      usuario.apellido = dto.apellido ?? undefined;
      usuario.email = dto.email.toLowerCase();
      usuario.passwordHash = passwordHash;
      usuario.telefono = dto.telefono ?? undefined;
      usuario.activo = true;
      usuario.rol = { id: 1 } as any;
      usuario.estado = { id: 1 } as any;
      usuario.fechaCreacion = new Date();
      const savedUsuario = await queryRunner.manager.save(usuario);

      const empleado = new Empleado();
      empleado.sucursal = savedSucursal;
      empleado.nombre = dto.nombre;
      empleado.apellido = dto.apellido ?? undefined;
      empleado.email = dto.email.toLowerCase();
      empleado.telefono = dto.telefono ?? undefined;
      empleado.activo = true;
      empleado.fechaCreacion = new Date();
      await queryRunner.manager.save(empleado);

      await queryRunner.commitTransaction();

      const payload = {
        sub: savedUsuario.id,
        email: savedUsuario.email,
        rolId: 1,
        empresaId: savedEmpresa.id,
        sucursalId: savedSucursal.id,
      };
      const accessToken = this.jwtService.sign(payload);

      const savedEmpleado = await this.empleadoRepo.findOne({
        where: { email: dto.email.toLowerCase() },
        relations: { sucursal: { empresa: true } },
      });

      return {
        accessToken,
        user: {
          id: savedUsuario.id,
          nombre: savedUsuario.nombre,
          apellido: savedUsuario.apellido,
          email: savedUsuario.email,
          rolId: 1,
          empleado: savedEmpleado
            ? {
                id: savedEmpleado.id,
                nombre: savedEmpleado.nombre,
                apellido: savedEmpleado.apellido,
                email: savedEmpleado.email,
                telefono: savedEmpleado.telefono,
                foto: savedEmpleado.foto,
                sucursal: savedEmpleado.sucursal
                  ? {
                      id: savedEmpleado.sucursal.id,
                      nombre: savedEmpleado.sucursal.nombre,
                      direccion: savedEmpleado.sucursal.direccion,
                      empresa: savedEmpleado.sucursal.empresa
                        ? {
                            id: savedEmpleado.sucursal.empresa.id,
                            nombre: savedEmpleado.sucursal.empresa.nombre,
                            slug: savedEmpleado.sucursal.empresa.slug,
                          }
                        : null,
                    }
                  : null,
              }
            : null,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (error instanceof ConflictException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al registrar usuario: ' + error.message,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async login(dto: LoginDto) {
    const user = await this.usuarioRepo.findOne({
      where: { email: dto.email.toLowerCase() },
      relations: { rol: true, empresa: true },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    const empleado = await this.empleadoRepo.findOne({
      where: { email: dto.email.toLowerCase() },
      relations: { sucursal: { empresa: true } },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      rolId: user.rol?.id,
      empresaId: user.empresa?.id,
      sucursalId: empleado?.sucursal?.id,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        rolId: user.rol?.id,
        empleado: empleado
          ? {
              id: empleado.id,
              nombre: empleado.nombre,
              apellido: empleado.apellido,
              email: empleado.email,
              telefono: empleado.telefono,
              foto: empleado.foto,
              sucursal: empleado.sucursal
                ? {
                    id: empleado.sucursal.id,
                    nombre: empleado.sucursal.nombre,
                    direccion: empleado.sucursal.direccion,
                    empresa: empleado.sucursal.empresa
                      ? {
                          id: empleado.sucursal.empresa.id,
                          nombre: empleado.sucursal.empresa.nombre,
                          slug: empleado.sucursal.empresa.slug,
                        }
                      : null,
                  }
                : null,
            }
          : null,
      },
    };
  }

  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
