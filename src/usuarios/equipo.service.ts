import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Usuario } from './entities/usuario.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { CuentaService } from '../auth/cuenta.service';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { esViolacionUnica } from '../auth/auth.service';
import { ROL_RECEPCIONISTA } from '../auth/roles';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateMiembroEquipoDto } from './dto/create-miembro-equipo.dto';
import { UpdateMiembroEquipoDto } from './dto/update-miembro-equipo.dto';

const MENSAJE_EMAIL_EN_USO = 'Ese email ya tiene una cuenta';

/** Lo que el panel ve de un recepcionista. */
export interface MiembroEquipo {
  id: number;
  nombre: string;
  apellido: string | null;
  email: string;
  sucursal: { id: number; nombre: string | null } | null;
  activo: boolean;
  invitacionPendiente: boolean;
  desactivadoPorSuscripcion: boolean;
}

/** Sin contraseña, sin Google y sin email verificado: todavía no aceptó la invitación. */
export function invitacionPendiente(u: Usuario): boolean {
  return !u.passwordHash && !u.googleId && !u.emailVerificado;
}

function aMiembro(u: Usuario): MiembroEquipo {
  return {
    id: u.id,
    nombre: u.nombre,
    apellido: u.apellido ?? null,
    email: u.email,
    sucursal: u.sucursal
      ? { id: u.sucursal.id, nombre: u.sucursal.nombre ?? null }
      : null,
    activo: u.activo,
    invitacionPendiente: invitacionPendiente(u),
    desactivadoPorSuscripcion: u.desactivadoPorSuscripcion,
  };
}

/** SPEC 08: gestión de los recepcionistas de la empresa (solo rol 1). */
@Injectable()
export class EquipoService {
  private readonly logger = new Logger(EquipoService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    private readonly suscripciones: SuscripcionesService,
    private readonly cuenta: CuentaService,
    private readonly cuentaCorreos: CuentaCorreosService,
  ) {}

  async listar(user: JwtPayload): Promise<MiembroEquipo[]> {
    const usuarios = await this.usuarioRepo.find({
      where: {
        empresa: { id: user.empresaId },
        rol: { id: ROL_RECEPCIONISTA },
      },
      // GoogleId no se selecciona por defecto y hace falta para `invitacionPendiente`.
      select: this.columnasMiembro(),
      relations: { sucursal: true },
      order: { nombre: 'ASC' },
    });
    return usuarios.map(aMiembro);
  }

  async invitar(
    user: JwtPayload,
    dto: CreateMiembroEquipoDto,
  ): Promise<MiembroEquipo> {
    const sucursal = await this.sucursalDeEmpresa(user, dto.sucursalId);
    await this.suscripciones.validarLimite(user.empresaId, 'recepcionistas');

    const email = dto.email.trim().toLowerCase();
    if (await this.usuarioRepo.exists({ where: { email } })) {
      throw new ConflictException(MENSAJE_EMAIL_EN_USO);
    }

    const estado = await this.estadoRepo.findOne({
      where: { tipo: 'Usuario', nombre: 'Activo' },
    });
    if (!estado) {
      throw new InternalServerErrorException(
        "No existe el estado 'Activo' de tipo 'Usuario'",
      );
    }

    let usuario: Usuario;
    try {
      usuario = await this.usuarioRepo.save(
        this.usuarioRepo.create({
          nombre: dto.nombre.trim(),
          apellido: dto.apellido?.trim() || undefined,
          email,
          passwordHash: null,
          emailVerificado: false,
          activo: true,
          desactivadoPorSuscripcion: false,
          tokenVersion: 0,
          empresa: { id: user.empresaId },
          rol: { id: ROL_RECEPCIONISTA },
          sucursal: { id: sucursal.id },
          estado,
        }),
      );
    } catch (error) {
      // Dos invitaciones simultáneas al mismo email: el índice único decide.
      if (esViolacionUnica(error)) {
        throw new ConflictException(MENSAJE_EMAIL_EN_USO);
      }
      throw error;
    }

    const creado = await this.miembroDeEmpresa(user, usuario.id);
    await this.enviarInvitacion(user, creado, sucursal.nombre ?? null);
    return aMiembro(creado);
  }

  async actualizar(
    user: JwtPayload,
    id: number,
    dto: UpdateMiembroEquipoDto,
  ): Promise<MiembroEquipo> {
    const usuario = await this.miembroDeEmpresa(user, id);
    const cambios: QueryDeepPartialEntity<Usuario> = {};
    let cierraSesion = false;

    if (dto.nombre !== undefined) cambios.nombre = dto.nombre.trim();
    if (dto.apellido !== undefined) {
      // Un apellido vacío lo borra (NULL), igual que al crearlo sin apellido.
      cambios.apellido = dto.apellido.trim() || (() => 'NULL');
    }

    if (
      dto.sucursalId !== undefined &&
      dto.sucursalId !== usuario.sucursal?.id
    ) {
      const sucursal = await this.sucursalDeEmpresa(user, dto.sucursalId);
      cambios.sucursal = { id: sucursal.id };
      cierraSesion = true;
    }

    if (dto.activo === false && usuario.activo) {
      // Desactivado a mano: volver a Pro no lo reactiva (no es excedente del plan).
      cambios.activo = false;
      cambios.desactivadoPorSuscripcion = false;
      cierraSesion = true;
    } else if (dto.activo === true && !usuario.activo) {
      await this.suscripciones.validarLimite(user.empresaId, 'recepcionistas');
      cambios.activo = true;
      cambios.desactivadoPorSuscripcion = false;
    }

    if (cierraSesion) {
      // El JwtAuthGuard compara TokenVersion en cada petición: la sesión se corta ya.
      cambios.tokenVersion = () => 'TokenVersion + 1';
    }

    if (Object.keys(cambios).length > 0) {
      await this.usuarioRepo.update({ id: usuario.id }, cambios);
    }
    return aMiembro(await this.miembroDeEmpresa(user, id));
  }

  async reenviarInvitacion(user: JwtPayload, id: number): Promise<void> {
    const usuario = await this.miembroDeEmpresa(user, id);
    if (!invitacionPendiente(usuario)) {
      throw new ConflictException('La invitación ya fue aceptada');
    }
    if (!usuario.activo) {
      throw new ConflictException(
        'El recepcionista está desactivado. Actívalo antes de reenviar la invitación',
      );
    }
    const enviado = await this.enviarInvitacion(
      user,
      usuario,
      usuario.sucursal?.nombre ?? null,
    );
    if (!enviado) {
      throw new HttpException(
        'Espera un momento antes de reenviar la invitación',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Genera el token (respetando el límite de envíos de SPEC 04) y manda el correo en
   * segundo plano. Devuelve false si el límite no permite enviar otro.
   */
  private async enviarInvitacion(
    user: JwtPayload,
    usuario: Usuario,
    sucursalNombre: string | null,
  ): Promise<boolean> {
    const token = await this.cuenta.prepararInvitacion(usuario);
    if (!token) {
      return false;
    }
    const [empresa, dueno] = await Promise.all([
      this.empresaRepo.findOne({ where: { id: user.empresaId } }),
      this.usuarioRepo.findOne({
        where: { id: user.sub },
        select: { id: true, nombre: true },
      }),
    ]);
    void this.cuentaCorreos
      .enviarInvitacion(
        { nombre: usuario.nombre, email: usuario.email },
        token,
        {
          empresa: empresa?.nombreComercial || empresa?.nombre || 'tu negocio',
          sucursal: sucursalNombre || 'tu sucursal',
          invitadoPor: dueno?.nombre || 'El administrador',
        },
      )
      .then((ok) => {
        if (!ok) {
          this.logger.warn(
            `No se pudo enviar la invitación al usuario ${usuario.id}`,
          );
        }
      });
    return true;
  }

  /** 404 si no existe o no es un recepcionista de la empresa del JWT. */
  private async miembroDeEmpresa(
    user: JwtPayload,
    id: number,
  ): Promise<Usuario> {
    const usuario = await this.usuarioRepo.findOne({
      where: {
        id,
        empresa: { id: user.empresaId },
        rol: { id: ROL_RECEPCIONISTA },
      },
      select: this.columnasMiembro(),
      relations: { sucursal: true },
    });
    if (!usuario) {
      throw new NotFoundException('Recepcionista no encontrado');
    }
    return usuario;
  }

  /** La sucursal debe ser de la empresa y estar activa. */
  private async sucursalDeEmpresa(
    user: JwtPayload,
    sucursalId: number,
  ): Promise<Sucursal> {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (
      !sucursal ||
      sucursal.empresa?.id !== user.empresaId ||
      sucursal.activo === false
    ) {
      throw new BadRequestException('La sucursal no es válida');
    }
    return sucursal;
  }

  /**
   * Columnas que hacen falta: las del listado, GoogleId (select: false) y las del
   * límite de envíos de reset, que usa `CuentaService.prepararInvitacion`.
   */
  private columnasMiembro() {
    return {
      id: true,
      nombre: true,
      apellido: true,
      email: true,
      passwordHash: true,
      googleId: true,
      emailVerificado: true,
      activo: true,
      desactivadoPorSuscripcion: true,
      tokenVersion: true,
      resetUltimoEnvio: true,
      resetVentanaInicio: true,
      resetEnviosVentana: true,
      sucursal: { id: true, nombre: true },
    } as const;
  }
}
