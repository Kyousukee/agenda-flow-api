import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { EmpresaSlug } from '../empresas/entities/empresa-slug.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Suscripcion } from '../suscripciones/entities/suscripcion.entity';
import { DIAS_PRUEBA } from '../suscripciones/planes';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { DatosNegocioDto, RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleRegistroDto } from './dto/google-registro.dto';
import { GoogleAuthService } from './google-auth.service';
import { ROL_RECEPCIONISTA } from './roles';
import {
  TokenCuenta,
  VIGENCIA_VERIFICACION_MS,
  generarToken,
} from './token-cuenta';

/** Datos con los que se crea una cuenta nueva (empresa, sucursal, usuario y empleado). */
interface DatosCuentaNueva extends DatosNegocioDto {
  nombre: string;
  apellido?: string;
  /** Ya en minúsculas. */
  email: string;
}

/** Cómo se autentica la cuenta nueva. */
type CredencialCuenta =
  | { tipo: 'password'; passwordHash: string; verificacion: TokenCuenta }
  | { tipo: 'google'; googleId: string };

const MENSAJE_EMAIL_REGISTRADO = 'El email ya está registrado';

/** SPEC 08: login con Google de un recepcionista que no aceptó su invitación. */
export const MENSAJE_INVITACION_PENDIENTE =
  'Acepta la invitación que llegó a tu correo antes de entrar con Google';

/** Relaciones que necesita construirRespuesta. SPEC 08: la sucursal del recepcionista. */
const RELACIONES_SESION = {
  rol: true,
  empresa: true,
  sucursal: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly cuentaCorreos: CuentaCorreosService,
    private readonly googleAuth: GoogleAuthService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existingUser = await this.usuarioRepo.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException(MENSAJE_EMAIL_REGISTRADO);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const verificacion = generarToken();

    const { usuario, sucursalId } = await this.crearCuenta(
      { ...dto, email },
      { tipo: 'password', passwordHash, verificacion },
    );

    // En segundo plano: un fallo de envío no afecta el registro, y el usuario
    // puede pedir otro correo con POST /auth/reenviar-verificacion.
    void this.cuentaCorreos.enviarVerificacion(
      { nombre: usuario.nombre, email: usuario.email },
      verificacion.token,
    );

    return this.construirRespuesta(usuario, sucursalId);
  }

  async login(dto: LoginDto) {
    const user = await this.usuarioRepo.findOne({
      where: { email: dto.email.toLowerCase() },
      relations: RELACIONES_SESION,
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // SPEC 05: una cuenta creada con Google no tiene contraseña hasta que la crea
    // con "olvidé mi contraseña".
    if (!user.passwordHash) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    return this.construirRespuesta(user);
  }

  /**
   * SPEC 05: inicia sesión con el ID token de Google. Si la cuenta de Google no
   * está vinculada pero el email existe, la vincula. Si no hay cuenta, responde
   * `requiereRegistro` para que el front pida los datos del negocio.
   */
  async loginGoogle(credential: string) {
    const perfil = await this.googleAuth.verificar(credential);
    const relations = RELACIONES_SESION;

    let user = await this.usuarioRepo.findOne({
      where: { googleId: perfil.sub },
      relations,
    });

    if (!user) {
      const porEmail = await this.usuarioRepo.findOne({
        where: { email: perfil.email },
        relations,
      });
      if (!porEmail) {
        return {
          requiereRegistro: true as const,
          perfil: {
            email: perfil.email,
            nombre: perfil.nombre,
            apellido: perfil.apellido ?? null,
          },
        };
      }
      if (!porEmail.activo) {
        throw new UnauthorizedException('Cuenta desactivada');
      }
      // SPEC 08: Google no acepta la invitación; el enlace del correo sí. Sin esto,
      // vincular dejaría el email verificado y activaría la cuenta sin pasar por él.
      if (porEmail.rol?.id === ROL_RECEPCIONISTA && !porEmail.emailVerificado) {
        throw new UnauthorizedException(MENSAJE_INVITACION_PENDIENTE);
      }
      user = await this.vincularGoogle(porEmail, perfil.sub);
    }

    if (!user.activo) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    return this.construirRespuesta(user);
  }

  /** SPEC 08: sesión del recepcionista que acaba de aceptar su invitación. */
  async sesionDe(usuarioId: number) {
    const user = await this.usuarioRepo.findOne({
      where: { id: usuarioId },
      relations: RELACIONES_SESION,
    });
    if (!user?.activo) {
      throw new UnauthorizedException('Cuenta desactivada');
    }
    return this.construirRespuesta(user);
  }

  /** SPEC 05: crea la cuenta con la identidad del ID token y los datos del negocio. */
  async registroGoogle(dto: GoogleRegistroDto) {
    const perfil = await this.googleAuth.verificar(dto.credential);

    const existente = await this.usuarioRepo.findOne({
      where: [{ email: perfil.email }, { googleId: perfil.sub }],
    });
    if (existente) {
      throw new ConflictException(
        'Ya existe una cuenta con este email. Inicia sesión con Google.',
      );
    }

    const { usuario, sucursalId } = await this.crearCuenta(
      {
        ...dto,
        nombre: dto.nombre?.trim() || perfil.nombre,
        apellido: dto.apellido?.trim() || perfil.apellido,
        email: perfil.email,
      },
      { tipo: 'google', googleId: perfil.sub },
    );

    return this.construirRespuesta(usuario, sucursalId);
  }

  /**
   * Vincula la cuenta de Google a un usuario existente con el mismo email. Google
   * ya comprobó el email, así que la cuenta queda verificada.
   *
   * Si el email no estaba verificado, la contraseña la pudo crear otra persona
   * que registró este email antes que su dueño. Por eso se borra y se cierran
   * las sesiones abiertas: el dueño puede crear otra con "olvidé mi contraseña".
   */
  private async vincularGoogle(user: Usuario, googleId: string) {
    const cambios: Partial<Usuario> = {
      googleId,
      emailVerificado: true,
      verificacionTokenHash: null,
      verificacionExpira: null,
    };
    if (!user.emailVerificado) {
      cambios.passwordHash = null;
      cambios.tokenVersion = user.tokenVersion + 1;
    }

    // Condicional: no reemplaza otra cuenta de Google ya vinculada a este usuario.
    const resultado = await this.usuarioRepo.update(
      { id: user.id, googleId: IsNull() },
      cambios,
    );
    if (resultado.affected !== 1) {
      throw new ConflictException(
        'Este email ya está vinculado a otra cuenta de Google.',
      );
    }

    return Object.assign(user, cambios);
  }

  /**
   * Crea en una transacción la empresa, su suscripción de prueba, la primera
   * sucursal, el usuario administrador y su empleado.
   */
  private async crearCuenta(
    datos: DatosCuentaNueva,
    credencial: CredencialCuenta,
  ): Promise<{ usuario: Usuario; sucursalId: number }> {
    const slug = await this.generateUniqueSlug(datos.empresaNombre);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const estadoEmpresa = await this.findEstado(
        queryRunner.manager,
        'Empresa',
        'Activa',
      );
      const estadoUsuario = await this.findEstado(
        queryRunner.manager,
        'Usuario',
        'Activo',
      );

      const empresa = new Empresa();
      empresa.nombre = datos.empresaNombre;
      empresa.nombreComercial = datos.nombreComercial ?? undefined;
      empresa.slug = slug;
      empresa.email = datos.empresaEmail ?? undefined;
      empresa.telefono = datos.telefono ?? undefined;
      empresa.estadoId = estadoEmpresa.id;
      empresa.fechaCreacion = new Date();
      const savedEmpresa = await queryRunner.manager.save(empresa);

      // SPEC 01: toda empresa nueva parte con la prueba de 14 días.
      const inicioPrueba = new Date();
      const suscripcion = new Suscripcion();
      suscripcion.empresaId = savedEmpresa.id;
      suscripcion.plan = 'Prueba';
      suscripcion.fechaInicio = inicioPrueba;
      suscripcion.fechaFin = new Date(
        inicioPrueba.getTime() + DIAS_PRUEBA * 24 * 60 * 60 * 1000,
      );
      suscripcion.excedenteDesactivado = false;
      await queryRunner.manager.save(suscripcion);

      const sucursal = new Sucursal();
      sucursal.empresa = savedEmpresa;
      sucursal.nombre = datos.sucursalNombre || 'Sucursal Principal';
      sucursal.direccion = datos.direccion ?? undefined;
      sucursal.comuna = datos.comuna ?? undefined;
      sucursal.ciudad = datos.ciudad ?? undefined;
      sucursal.region = datos.region ?? undefined;
      sucursal.pais = datos.pais || 'Chile';
      sucursal.latitud = datos.latitud ?? undefined;
      sucursal.longitud = datos.longitud ?? undefined;
      sucursal.telefono = datos.telefono ?? undefined;
      sucursal.activo = true;
      sucursal.fechaCreacion = new Date();
      const savedSucursal = await queryRunner.manager.save(sucursal);

      const usuario = new Usuario();
      usuario.empresa = savedEmpresa;
      usuario.nombre = datos.nombre;
      usuario.apellido = datos.apellido ?? undefined;
      usuario.email = datos.email;
      usuario.telefono = datos.telefono ?? undefined;
      usuario.activo = true;
      usuario.rol = { id: 1 } as any;
      usuario.estado = estadoUsuario;
      usuario.fechaCreacion = new Date();
      usuario.tokenVersion = 0;

      if (credencial.tipo === 'password') {
        // SPEC 04: se guarda solo el hash. Este correo cuenta como el primer envío.
        const ahora = new Date();
        usuario.passwordHash = credencial.passwordHash;
        usuario.emailVerificado = false;
        usuario.verificacionTokenHash = credencial.verificacion.hash;
        usuario.verificacionExpira = new Date(
          ahora.getTime() + VIGENCIA_VERIFICACION_MS,
        );
        usuario.verificacionUltimoEnvio = ahora;
        usuario.verificacionVentanaInicio = ahora;
        usuario.verificacionEnviosVentana = 1;
      } else {
        // SPEC 05: Google ya verificó el email; la cuenta no tiene contraseña.
        usuario.passwordHash = null;
        usuario.googleId = credencial.googleId;
        usuario.emailVerificado = true;
      }
      const savedUsuario = await queryRunner.manager.save(usuario);

      const empleado = new Empleado();
      empleado.sucursal = savedSucursal;
      empleado.nombre = datos.nombre;
      empleado.apellido = datos.apellido ?? undefined;
      empleado.email = datos.email;
      empleado.telefono = datos.telefono ?? undefined;
      empleado.activo = true;
      empleado.fechaCreacion = new Date();
      await queryRunner.manager.save(empleado);

      await queryRunner.commitTransaction();

      return { usuario: savedUsuario, sucursalId: savedSucursal.id };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (error instanceof ConflictException) {
        throw error;
      }
      // Dos registros simultáneos con el mismo email o cuenta de Google.
      if (esViolacionUnica(error)) {
        throw new ConflictException(MENSAJE_EMAIL_REGISTRADO);
      }
      // El detalle queda en el log del servidor; al cliente no se le filtra.
      this.logger.error(
        'Error al registrar usuario',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'No se pudo completar el registro. Inténtalo de nuevo.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * JWT y datos del usuario que devuelven el login, el registro y Google.
   * `sucursalId` es la sucursal recién creada, por si el empleado aún no se lee.
   */
  private async construirRespuesta(user: Usuario, sucursalId?: number) {
    // Acotado a su empresa: otra empresa podría crear un empleado con este mismo email.
    const empleado = await this.empleadoRepo.findOne({
      where: {
        email: user.email,
        sucursal: { empresa: { id: user.empresa?.id } },
      },
      relations: { sucursal: { empresa: true } },
    });

    // SPEC 08: la sucursal del recepcionista es la asignada en Usuario.SucursalId, nunca
    // la de un empleado con su email: es la que fija su alcance en todos los endpoints.
    const esRecepcionista = user.rol?.id === ROL_RECEPCIONISTA;
    const sucursalRecepcionista = esRecepcionista
      ? user.sucursal
        ? { id: user.sucursal.id, nombre: user.sucursal.nombre ?? null }
        : null
      : undefined;

    const payload = {
      sub: user.id,
      email: user.email,
      rolId: user.rol?.id,
      empresaId: user.empresa?.id,
      sucursalId: esRecepcionista
        ? sucursalRecepcionista?.id
        : (empleado?.sucursal?.id ?? sucursalId),
      tokenVersion: user.tokenVersion,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        rolId: user.rol?.id,
        emailVerificado: user.emailVerificado,
        ...(esRecepcionista && { sucursal: sucursalRecepcionista }),
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

  private async findEstado(
    manager: EntityManager,
    tipo: string,
    nombre: string,
  ): Promise<Estado> {
    const estado = await manager.findOne(Estado, { where: { tipo, nombre } });
    if (!estado) {
      throw new InternalServerErrorException(
        `No existe el estado '${nombre}' de tipo '${tipo}'`,
      );
    }
    return estado;
  }

  /** El slug es único y no puede quedar vacío (p. ej. un nombre solo con símbolos). */
  private async generateUniqueSlug(text: string): Promise<string> {
    const base =
      this.generateSlug(text).slice(0, 90).replace(/-$/, '') || 'empresa';
    const manager = this.dataSource.manager;
    const enUso = async (slug: string) =>
      (await manager.existsBy(Empresa, { slug })) ||
      (await manager.existsBy(EmpresaSlug, { slug }));

    if (base !== 'empresa' && !(await enUso(base))) {
      return base;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

/** SQL Server: 2627 = restricción UNIQUE, 2601 = índice único. */
export function esViolacionUnica(error: unknown): boolean {
  const driver = (error as { driverError?: { number?: number } })?.driverError;
  const numero =
    driver?.number ?? (error as { number?: number } | null)?.number;
  return numero === 2627 || numero === 2601;
}
