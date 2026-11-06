import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MssqlParameter, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { Usuario } from '../usuarios/entities/usuario.entity';
import {
  VIGENCIA_RESET_MS,
  VIGENCIA_VERIFICACION_MS,
  evaluarLimiteEnvio,
  generarToken,
  hashToken,
} from './token-cuenta';

const MENSAJE_TOKEN_INVALIDO = 'El enlace no es válido o venció';

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
    const passwordHash = await bcrypt.hash(password, 10);

    // Un solo UPDATE condicional: subir TokenVersion cierra todas las sesiones, y
    // usar el enlace demuestra que controla el buzón, así que el email queda verificado.
    const resultado = await this.usuarioRepo
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
      .andWhere('Activo = 1')
      .execute();

    if (resultado.affected !== 1) {
      throw new BadRequestException(MENSAJE_TOKEN_INVALIDO);
    }
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
