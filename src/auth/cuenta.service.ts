import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MssqlParameter, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { ROL_RECEPCIONISTA } from './roles';
import {
  VIGENCIA_INVITACION_MS,
  VIGENCIA_RESET_MS,
  VIGENCIA_VERIFICACION_MS,
  evaluarLimiteEnvio,
  generarToken,
  hashToken,
} from './token-cuenta';

const MENSAJE_TOKEN_INVALIDO = 'El enlace no es válido o venció';
/** SPEC 08: GET /auth/invitacion/:token y POST /auth/aceptar-invitacion. */
export const MENSAJE_INVITACION_INVALIDA = 'El enlace no es válido o expiró';

/** SPEC 08: lo que la página pública de la invitación puede mostrar. */
export interface InvitacionVigente {
  nombre: string;
  email: string;
  empresa: string | null;
  sucursal: string | null;
}

/** Campos del límite de envíos y del token vigente, por tipo de correo. */
const CAMPOS = {
  verificacion: {
    hash: 'verificacionTokenHash',
    expira: 'verificacionExpira',
    ultimoEnvio: 'verificacionUltimoEnvio',
    ventanaInicio: 'verificacionVentanaInicio',
    enviosVentana: 'verificacionEnviosVentana',
    columnaUltimoEnvio: 'VerificacionUltimoEnvio',
  },
  reset: {
    hash: 'resetTokenHash',
    expira: 'resetExpira',
    ultimoEnvio: 'resetUltimoEnvio',
    ventanaInicio: 'resetVentanaInicio',
    enviosVentana: 'resetEnviosVentana',
    columnaUltimoEnvio: 'ResetUltimoEnvio',
  },
} as const;

type TipoCorreo = keyof typeof CAMPOS;

/**
 * En un WHERE, TypeORM no usa el tipo de la columna y el driver enviaría un Date
 * como `datetime`, que redondea los milisegundos. Las comparaciones contra
 * columnas `datetime2` tienen que declarar el tipo.
 */
const datetime2 = (fecha: Date) => new MssqlParameter(fecha, 'datetime2');

@Injectable()
export class CuentaService {
  private readonly logger = new Logger(CuentaService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly cuentaCorreos: CuentaCorreosService,
  ) {}

  async verificarEmail(token: string): Promise<{ emailVerificado: true }> {
    // Un solo UPDATE condicional: dos peticiones simultáneas no pueden usar el mismo enlace.
    const resultado = await this.usuarioRepo
      .createQueryBuilder()
      .update(Usuario)
      .set({
        emailVerificado: true,
        verificacionTokenHash: null,
        verificacionExpira: null,
      })
      .where('VerificacionTokenHash = :hash', { hash: hashToken(token) })
      .andWhere('VerificacionExpira > :ahora', {
        ahora: datetime2(new Date()),
      })
      .execute();

    if (resultado.affected !== 1) {
      throw new BadRequestException(MENSAJE_TOKEN_INVALIDO);
    }
    return { emailVerificado: true };
  }

  async reenviarVerificacion(
    usuarioId: number,
  ): Promise<{ emailVerificado: boolean }> {
    const usuario = await this.usuarioRepo.findOne({
      where: { id: usuarioId },
    });
    if (!usuario) {
      return { emailVerificado: false };
    }
    if (usuario.emailVerificado) {
      return { emailVerificado: true };
    }

    const token = await this.reservarEnvio(
      usuario,
      'verificacion',
      VIGENCIA_VERIFICACION_MS,
    );
    if (token) {
      void this.cuentaCorreos.enviarVerificacion(
        { nombre: usuario.nombre, email: usuario.email },
        token,
      );
    }
    return { emailVerificado: false };
  }

  /**
   * No devuelve una promesa a propósito: el controlador responde sin esperar la
   * búsqueda, para que el tiempo de respuesta no revele si la cuenta existe.
   */
  olvideContrasena(email: string): void {
    void this.procesarOlvido(email.toLowerCase());
  }

  async restablecerContrasena(token: string, password: string): Promise<void> {
    const afectadas = await this.fijarContrasena(token, password);
    if (afectadas !== 1) {
      throw new BadRequestException(MENSAJE_TOKEN_INVALIDO);
    }
  }

  /**
   * SPEC 08: datos que muestra la página de la invitación. Solo sirve para un
   * recepcionista activo con el token vigente; no devuelve nada más del usuario.
   */
  async consultarInvitacion(token: string): Promise<InvitacionVigente> {
    const usuario = await this.invitacionVigente(token);
    return {
      nombre: usuario.nombre,
      email: usuario.email,
      empresa:
        usuario.empresa?.nombreComercial || usuario.empresa?.nombre || null,
      sucursal: usuario.sucursal?.nombre ?? null,
    };
  }

  /**
   * SPEC 08: define la contraseña con el token de la invitación. Es el mismo UPDATE
   * condicional de restablecerContrasena (email verificado, TokenVersion + 1, tokens
   * limpios), acotado además al recepcionista. Devuelve su id para iniciar sesión.
   */
  async aceptarInvitacion(token: string, password: string): Promise<number> {
    const usuario = await this.invitacionVigente(token);
    const afectadas = await this.fijarContrasena(token, password, usuario.id);
    if (afectadas !== 1) {
      throw new BadRequestException(MENSAJE_INVITACION_INVALIDA);
    }
    return usuario.id;
  }

  private async invitacionVigente(token: string): Promise<Usuario> {
    const usuario = await this.usuarioRepo.findOne({
      where: {
        resetTokenHash: hashToken(token),
        rol: { id: ROL_RECEPCIONISTA },
        activo: true,
      },
      relations: { empresa: true, sucursal: true },
    });
    if (!usuario?.resetExpira || usuario.resetExpira.getTime() <= Date.now()) {
      throw new BadRequestException(MENSAJE_INVITACION_INVALIDA);
    }
    return usuario;
  }

  /**
   * Un solo UPDATE condicional: subir TokenVersion cierra todas las sesiones, y
   * usar el enlace demuestra que controla el buzón, así que el email queda verificado.
   * Con `soloRecepcionista`, además exige ese id y el rol 2 (invitación).
   */
  private async fijarContrasena(
    token: string,
    password: string,
    soloRecepcionista?: number,
  ): Promise<number> {
    const passwordHash = await bcrypt.hash(password, 10);

    const consulta = this.usuarioRepo
      .createQueryBuilder()
      .update(Usuario)
      .set({
        passwordHash,
        tokenVersion: () => 'TokenVersion + 1',
        emailVerificado: true,
        resetTokenHash: null,
        resetExpira: null,
        verificacionTokenHash: null,
        verificacionExpira: null,
      })
      .where('ResetTokenHash = :hash', { hash: hashToken(token) })
      .andWhere('ResetExpira > :ahora', { ahora: datetime2(new Date()) })
      .andWhere('Activo = 1');
    if (soloRecepcionista !== undefined) {
      consulta
        .andWhere('id = :id', { id: soloRecepcionista })
        .andWhere('RolId = :rol', { rol: ROL_RECEPCIONISTA });
    }

    const resultado = await consulta.execute();
    return resultado.affected ?? 0;
  }

  private async procesarOlvido(email: string): Promise<void> {
    try {
      const usuario = await this.usuarioRepo.findOne({ where: { email } });
      if (!usuario?.activo) {
        return;
      }

      const token = await this.reservarEnvio(
        usuario,
        'reset',
        VIGENCIA_RESET_MS,
      );
      if (token) {
        await this.cuentaCorreos.enviarRestablecimiento(
          { nombre: usuario.nombre, email: usuario.email },
          token,
        );
      }
    } catch (err) {
      this.logger.error(
        `No se pudo procesar el restablecimiento: ${(err as Error).message}`,
      );
    }
  }

  /**
   * SPEC 08: token de invitación de un recepcionista. Usa las columnas de reset
   * (ResetTokenHash / ResetExpira) con vigencia de 7 días y el mismo límite de envíos.
   * Devuelve el token en claro, o null si el límite no permite enviar otro.
   */
  prepararInvitacion(usuario: Usuario): Promise<string | null> {
    return this.reservarEnvio(usuario, 'reset', VIGENCIA_INVITACION_MS);
  }

  /**
   * Aplica el límite por usuario y tipo y, si se puede enviar, guarda un token nuevo
   * que reemplaza al anterior. Devuelve el token, o null si no corresponde enviar.
   */
  private async reservarEnvio(
    usuario: Usuario,
    tipo: TipoCorreo,
    vigenciaMs: number,
  ): Promise<string | null> {
    const campos = CAMPOS[tipo];
    const ahora = new Date();
    const ultimoEnvio = usuario[campos.ultimoEnvio] ?? null;

    const evaluacion = evaluarLimiteEnvio(
      {
        ultimoEnvio,
        ventanaInicio: usuario[campos.ventanaInicio] ?? null,
        enviosVentana: usuario[campos.enviosVentana],
      },
      ahora,
    );
    if (!evaluacion.permitido) {
      return null;
    }

    const { token, hash } = generarToken();
    const consulta = this.usuarioRepo
      .createQueryBuilder()
      .update(Usuario)
      .set({
        [campos.hash]: hash,
        [campos.expira]: new Date(ahora.getTime() + vigenciaMs),
        [campos.ultimoEnvio]: ahora,
        [campos.ventanaInicio]: evaluacion.ventanaInicio,
        [campos.enviosVentana]: evaluacion.enviosVentana,
      } as QueryDeepPartialEntity<Usuario>)
      .where('id = :id', { id: usuario.id });

    // Condicionado al valor leído: de dos peticiones simultáneas, solo una envía.
    if (ultimoEnvio) {
      consulta.andWhere(`${campos.columnaUltimoEnvio} = :ultimoEnvio`, {
        ultimoEnvio: datetime2(ultimoEnvio),
      });
    } else {
      consulta.andWhere(`${campos.columnaUltimoEnvio} IS NULL`);
    }

    const resultado = await consulta.execute();
    return resultado.affected === 1 ? token : null;
  }
}
