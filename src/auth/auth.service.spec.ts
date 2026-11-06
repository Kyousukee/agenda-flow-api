import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VIGENCIA_VERIFICACION_MS, hashToken } from './token-cuenta';

const dto = {
  nombre: 'Ana',
  email: 'ANA@correo.cl',
  password: 'secreto123',
  empresaNombre: 'Barbería Central',
} as RegisterDto;

function preparar(opciones: { fallaCommit?: boolean } = {}) {
  const orden: string[] = [];
  const guardados: unknown[] = [];

  const queryRunner = {
    connect: jest.fn(() => Promise.resolve()),
    startTransaction: jest.fn(() => Promise.resolve()),
    commitTransaction: jest.fn(() => {
      orden.push('commit');
      return opciones.fallaCommit
        ? Promise.reject(new Error('fallo de commit'))
        : Promise.resolve();
    }),
    rollbackTransaction: jest.fn(() => Promise.resolve()),
    release: jest.fn(() => Promise.resolve()),
    manager: {
      findOne: jest.fn(() => Promise.resolve({ id: 1 })),
      save: jest.fn((entidad: { id?: number }) => {
        entidad.id = guardados.push(entidad);
        return Promise.resolve(entidad);
      }),
    },
  };

  const enviarVerificacion = jest.fn(() => {
    orden.push('correo');
    return Promise.resolve(true);
  });
  const sign = jest.fn((_payload: Record<string, unknown>) => 'jwt-firmado');
  const usuarioFindOne = jest.fn(() => Promise.resolve(null as unknown));

  const servicio = new AuthService(
    { findOne: usuarioFindOne } as unknown as Repository<Usuario>,
    {
      findOne: jest.fn(() => Promise.resolve(null)),
    } as unknown as Repository<Empleado>,
    {
      createQueryRunner: () => queryRunner,
      manager: { existsBy: jest.fn(() => Promise.resolve(false)) },
    } as unknown as DataSource,
    { sign } as unknown as JwtService,
    { enviarVerificacion } as unknown as CuentaCorreosService,
  );

  const usuarioGuardado = () =>
    guardados.find((g) => g instanceof Usuario) as Usuario;

  return {
    servicio,
    orden,
    enviarVerificacion,
    sign,
    usuarioFindOne,
    usuarioGuardado,
  };
}

describe('AuthService', () => {
  describe('register', () => {
    it('devuelve accessToken y emailVerificado = false', async () => {
      const { servicio, usuarioGuardado } = preparar();

      const respuesta = await servicio.register(dto);

      expect(respuesta.accessToken).toBe('jwt-firmado');
      expect(respuesta.user.emailVerificado).toBe(false);
      expect(usuarioGuardado().emailVerificado).toBe(false);
    });

    it('guarda el hash del token que envía por correo, nunca el token', async () => {
      const { servicio, enviarVerificacion, usuarioGuardado } = preparar();

      await servicio.register(dto);

      const [destinatario, token] = enviarVerificacion.mock
        .calls[0] as unknown as [{ nombre: string; email: string }, string];
      expect(destinatario).toEqual({ nombre: 'Ana', email: 'ana@correo.cl' });
      expect(usuarioGuardado().verificacionTokenHash).toBe(hashToken(token));
      expect(usuarioGuardado().verificacionTokenHash).not.toBe(token);
    });

    it('fija la vigencia de 24 horas y cuenta el primer envío', async () => {
      const { servicio, usuarioGuardado } = preparar();

      await servicio.register(dto);

      const usuario = usuarioGuardado();
      expect(usuario.verificacionUltimoEnvio).toBeInstanceOf(Date);
      expect(usuario.verificacionVentanaInicio).toEqual(
        usuario.verificacionUltimoEnvio,
      );
      expect(usuario.verificacionEnviosVentana).toBe(1);
      expect(usuario.verificacionExpira!.getTime()).toBe(
        usuario.verificacionUltimoEnvio!.getTime() + VIGENCIA_VERIFICACION_MS,
      );
    });

    it('envía el correo después del commit', async () => {
      const { servicio, orden } = preparar();

      await servicio.register(dto);

      expect(orden).toEqual(['commit', 'correo']);
    });

    it('no envía el correo si la transacción falla', async () => {
      const { servicio, enviarVerificacion } = preparar({ fallaCommit: true });

      await expect(servicio.register(dto)).rejects.toThrow(
        'No se pudo completar el registro',
      );
      expect(enviarVerificacion).not.toHaveBeenCalled();
    });

    it('firma el JWT con tokenVersion 0', async () => {
      const { servicio, sign } = preparar();

      await servicio.register(dto);

      expect(sign.mock.calls[0][0]).toMatchObject({ tokenVersion: 0 });
    });
  });

  describe('login', () => {
    it.each([true, false])(
      'devuelve emailVerificado = %s y firma con la versión de la cuenta',
      async (emailVerificado) => {
        const { servicio, sign, usuarioFindOne } = preparar();
        usuarioFindOne.mockResolvedValue({
          id: 1,
          nombre: 'Ana',
          email: 'ana@correo.cl',
          passwordHash: await bcrypt.hash('secreto123', 4),
          activo: true,
          emailVerificado,
          tokenVersion: 3,
          rol: { id: 1 },
          empresa: { id: 1 },
        });

        const respuesta = await servicio.login({
          email: 'ana@correo.cl',
          password: 'secreto123',
        });

        expect(respuesta.user.emailVerificado).toBe(emailVerificado);
        expect(sign.mock.calls[0][0]).toMatchObject({ tokenVersion: 3 });
      },
    );
  });
});
