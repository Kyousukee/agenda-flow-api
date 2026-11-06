import { BadRequestException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { CuentaService } from './cuenta.service';
import {
  MAX_ENVIOS_POR_VENTANA,
  VIGENCIA_RESET_MS,
  hashToken,
} from './token-cuenta';

function preparar(opciones: { usuario?: Partial<Usuario> | null } = {}) {
  const consultas: {
    set: Record<string, unknown>;
    where: string[];
    parametros: Record<string, unknown>;
  }[] = [];
  const afectadas = { valor: 1 };

  const createQueryBuilder = jest.fn(() => {
    const consulta = {
      set: {} as Record<string, unknown>,
      where: [] as string[],
      parametros: {} as Record<string, unknown>,
    };
    consultas.push(consulta);
    const agregarWhere = (sql: string, parametros = {}) => {
      consulta.where.push(sql);
      Object.assign(consulta.parametros, parametros);
      return qb;
    };
    const qb = {
      update: () => qb,
      set: (valores: Record<string, unknown>) => {
        consulta.set = valores;
        return qb;
      },
      where: agregarWhere,
      andWhere: agregarWhere,
      execute: () => Promise.resolve({ affected: afectadas.valor }),
    };
    return qb;
  });

  const enviarVerificacion = jest.fn(() => Promise.resolve(true));
  const enviarRestablecimiento = jest.fn(() => Promise.resolve(true));
  const findOne = jest.fn(() => Promise.resolve(opciones.usuario ?? null));
  const servicio = new CuentaService(
    {
      createQueryBuilder,
      findOne,
    } as unknown as Repository<Usuario>,
    {
      enviarVerificacion,
      enviarRestablecimiento,
    } as unknown as CuentaCorreosService,
  );

  return {
    servicio,
    consultas,
    afectadas,
    findOne,
    enviarVerificacion,
    enviarRestablecimiento,
  };
}

/** Espera a que termine el trabajo en segundo plano. */
const terminarSegundoPlano = () =>
  new Promise((resolve) => setTimeout(resolve, 10));

describe('CuentaService', () => {
  describe('verificarEmail', () => {
    it('busca por el hash, exige vigencia y marca el email como verificado', async () => {
      const { servicio, consultas } = preparar();

      await expect(servicio.verificarEmail('tok123')).resolves.toEqual({
        emailVerificado: true,
      });

      const [consulta] = consultas;
      expect(consulta.parametros.hash).toBe(hashToken('tok123'));
      expect(consulta.where).toEqual([
        'VerificacionTokenHash = :hash',
        'VerificacionExpira > :ahora',
      ]);
      expect(consulta.set).toEqual({
        emailVerificado: true,
        verificacionTokenHash: null,
        verificacionExpira: null,
      });
    });

    it('responde 400 si el token no sirve', async () => {
      const { servicio, afectadas } = preparar();
      afectadas.valor = 0;

      const error = await servicio
        .verificarEmail('tok123')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        'El enlace no es válido o venció',
      );
    });
  });

  describe('reenviarVerificacion', () => {
    const haceDosMinutos = () => new Date(Date.now() - 2 * 60 * 1000);
    const sinVerificar: Partial<Usuario> = {
      id: 1,
      nombre: 'Ana',
      email: 'ana@correo.cl',
      emailVerificado: false,
      verificacionEnviosVentana: 0,
    };

    it('con el email ya verificado no envía nada', async () => {
      const { servicio, consultas, enviarVerificacion } = preparar({
        usuario: { ...sinVerificar, emailVerificado: true },
      });

      await expect(servicio.reenviarVerificacion(1)).resolves.toEqual({
        emailVerificado: true,
      });
      expect(consultas).toHaveLength(0);
      expect(enviarVerificacion).not.toHaveBeenCalled();
    });

    it('guarda un token nuevo y envía el token cuyo hash se guardó', async () => {
      const { servicio, consultas, enviarVerificacion } = preparar({
        usuario: sinVerificar,
      });

      await expect(servicio.reenviarVerificacion(1)).resolves.toEqual({
        emailVerificado: false,
      });

      const [destinatario, token] = enviarVerificacion.mock
        .calls[0] as unknown as [{ email: string }, string];
      expect(destinatario.email).toBe('ana@correo.cl');
      expect(consultas[0].set.verificacionTokenHash).toBe(hashToken(token));
      expect(consultas[0].set.verificacionEnviosVentana).toBe(1);
      expect(consultas[0].where).toContain('VerificacionUltimoEnvio IS NULL');
    });

    it('condiciona la escritura al último envío leído', async () => {
      const ultimo = haceDosMinutos();
      const { servicio, consultas } = preparar({
        usuario: {
          ...sinVerificar,
          verificacionUltimoEnvio: ultimo,
          verificacionVentanaInicio: ultimo,
          verificacionEnviosVentana: 1,
        },
      });

      await servicio.reenviarVerificacion(1);

      expect(consultas[0].where).toContain(
        'VerificacionUltimoEnvio = :ultimoEnvio',
      );
      expect(consultas[0].parametros.ultimoEnvio).toMatchObject({
        value: ultimo,
        type: 'datetime2',
      });
      expect(consultas[0].set.verificacionEnviosVentana).toBe(2);
    });

    it('dentro del minuto responde igual y no envía', async () => {
      const ahora = new Date();
      const { servicio, consultas, enviarVerificacion } = preparar({
        usuario: {
          ...sinVerificar,
          verificacionUltimoEnvio: ahora,
          verificacionVentanaInicio: ahora,
          verificacionEnviosVentana: 1,
        },
      });

      await expect(servicio.reenviarVerificacion(1)).resolves.toEqual({
        emailVerificado: false,
      });
      expect(consultas).toHaveLength(0);
      expect(enviarVerificacion).not.toHaveBeenCalled();
    });

    it('con la ventana llena responde igual y no envía', async () => {
      const { servicio, enviarVerificacion } = preparar({
        usuario: {
          ...sinVerificar,
          verificacionUltimoEnvio: haceDosMinutos(),
          verificacionVentanaInicio: haceDosMinutos(),
          verificacionEnviosVentana: MAX_ENVIOS_POR_VENTANA,
        },
      });

      await expect(servicio.reenviarVerificacion(1)).resolves.toEqual({
        emailVerificado: false,
      });
      expect(enviarVerificacion).not.toHaveBeenCalled();
    });

    it('si otra petición ganó la carrera, no envía', async () => {
      const { servicio, afectadas, enviarVerificacion } = preparar({
        usuario: sinVerificar,
      });
      afectadas.valor = 0;

      await expect(servicio.reenviarVerificacion(1)).resolves.toEqual({
        emailVerificado: false,
      });
      expect(enviarVerificacion).not.toHaveBeenCalled();
    });
  });

  describe('olvideContrasena', () => {
    const activo: Partial<Usuario> = {
      id: 1,
      nombre: 'Ana',
      email: 'ana@correo.cl',
      activo: true,
      emailVerificado: false,
      resetEnviosVentana: 0,
    };

    it('devuelve el control sin esperar la búsqueda', () => {
      const { servicio, enviarRestablecimiento } = preparar({
        usuario: activo,
      });

      expect(servicio.olvideContrasena('ana@correo.cl')).toBeUndefined();
      expect(enviarRestablecimiento).not.toHaveBeenCalled();
    });

    it('busca en minúsculas y envía el token cuyo hash guardó en las columnas de reset', async () => {
      const { servicio, consultas, findOne, enviarRestablecimiento } = preparar(
        { usuario: activo },
      );

      servicio.olvideContrasena('ANA@correo.cl');
      await terminarSegundoPlano();

      expect(findOne).toHaveBeenCalledWith({
        where: { email: 'ana@correo.cl' },
      });
      const [, token] = enviarRestablecimiento.mock.calls[0] as unknown as [
        unknown,
        string,
      ];
      expect(consultas[0].set.resetTokenHash).toBe(hashToken(token));
      expect(consultas[0].set.resetEnviosVentana).toBe(1);
      expect(consultas[0].set).not.toHaveProperty('verificacionTokenHash');
      expect(consultas[0].set).not.toHaveProperty('verificacionEnviosVentana');
      expect(consultas[0].where).toContain('ResetUltimoEnvio IS NULL');
    });

    it('fija la vigencia de 1 hora', async () => {
      const { servicio, consultas } = preparar({ usuario: activo });

      servicio.olvideContrasena('ana@correo.cl');
      await terminarSegundoPlano();

      const expira = consultas[0].set.resetExpira as Date;
      const ultimo = consultas[0].set.resetUltimoEnvio as Date;
      expect(expira.getTime() - ultimo.getTime()).toBe(VIGENCIA_RESET_MS);
    });

    it.each([
      ['el email no existe', null],
      ['la cuenta está desactivada', { ...activo, activo: false }],
    ])('no envía nada si %s', async (_caso, usuario) => {
      const { servicio, consultas, enviarRestablecimiento } = preparar({
        usuario,
      });

      servicio.olvideContrasena('ana@correo.cl');
      await terminarSegundoPlano();

      expect(consultas).toHaveLength(0);
      expect(enviarRestablecimiento).not.toHaveBeenCalled();
    });

    it('dentro del minuto no envía', async () => {
      const ahora = new Date();
      const { servicio, enviarRestablecimiento } = preparar({
        usuario: {
          ...activo,
          resetUltimoEnvio: ahora,
          resetVentanaInicio: ahora,
          resetEnviosVentana: 1,
        },
      });

      servicio.olvideContrasena('ana@correo.cl');
      await terminarSegundoPlano();

      expect(enviarRestablecimiento).not.toHaveBeenCalled();
    });

    it('un límite de verificación agotado no afecta al restablecimiento', async () => {
      const ahora = new Date();
      const { servicio, enviarRestablecimiento } = preparar({
        usuario: {
          ...activo,
          verificacionUltimoEnvio: ahora,
          verificacionVentanaInicio: ahora,
          verificacionEnviosVentana: MAX_ENVIOS_POR_VENTANA,
        },
      });

      servicio.olvideContrasena('ana@correo.cl');
      await terminarSegundoPlano();

      expect(enviarRestablecimiento).toHaveBeenCalledTimes(1);
    });

    it('un error de base de datos queda en el log y no se propaga', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { servicio, findOne, enviarRestablecimiento } = preparar();
      findOne.mockRejectedValue(new Error('conexión perdida'));

      servicio.olvideContrasena('ana@correo.cl');
      await terminarSegundoPlano();

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('conexión perdida'),
      );
      expect(enviarRestablecimiento).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('restablecerContrasena', () => {
    it('actualiza todo en un solo UPDATE condicionado al token, la vigencia y Activo', async () => {
      const { servicio, consultas } = preparar();

      await servicio.restablecerContrasena('tok123', 'clave-nueva');

      expect(consultas).toHaveLength(1);
      const [consulta] = consultas;
      expect(consulta.parametros.hash).toBe(hashToken('tok123'));
      expect(consulta.where).toEqual([
        'ResetTokenHash = :hash',
        'ResetExpira > :ahora',
        'Activo = 1',
      ]);
      expect(consulta.set).toMatchObject({
        emailVerificado: true,
        resetTokenHash: null,
        resetExpira: null,
        verificacionTokenHash: null,
        verificacionExpira: null,
      });
      expect((consulta.set.tokenVersion as () => string)()).toBe(
        'TokenVersion + 1',
      );
    });

    it('guarda la contraseña con bcrypt', async () => {
      const { servicio, consultas } = preparar();

      await servicio.restablecerContrasena('tok123', 'clave-nueva');

      const hash = consultas[0].set.passwordHash as string;
      expect(hash).not.toBe('clave-nueva');
      await expect(bcrypt.compare('clave-nueva', hash)).resolves.toBe(true);
    });

    it('responde 400 si el token no sirve', async () => {
      const { servicio, afectadas } = preparar();
      afectadas.valor = 0;

      const error = await servicio
        .restablecerContrasena('tok123', 'clave-nueva')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        'El enlace no es válido o venció',
      );
    });
  });
});
