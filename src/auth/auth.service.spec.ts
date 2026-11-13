import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { CuentaCorreosService } from '../correos/cuenta-correos.service';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AuthService } from './auth.service';
import { GoogleAuthService, PerfilGoogle } from './google-auth.service';
import { GoogleRegistroDto } from './dto/google-registro.dto';
import { RegisterDto } from './dto/register.dto';
import { VIGENCIA_VERIFICACION_MS, hashToken } from './token-cuenta';

const dto = {
  nombre: 'Ana',
  email: 'ANA@correo.cl',
  password: 'secreto123',
  empresaNombre: 'Barbería Central',
} as RegisterDto;

const perfilGoogle: PerfilGoogle = {
  sub: 'google-123',
  email: 'ana@correo.cl',
  nombre: 'Ana',
  apellido: 'Pérez',
};

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
  const usuarioUpdate = jest.fn(() => Promise.resolve({ affected: 1 }));
  const verificarGoogle = jest.fn(() => Promise.resolve(perfilGoogle));

  const servicio = new AuthService(
    {
      findOne: usuarioFindOne,
      update: usuarioUpdate,
    } as unknown as Repository<Usuario>,
    {
      findOne: jest.fn(() => Promise.resolve(null)),
    } as unknown as Repository<Empleado>,
    {
      createQueryRunner: () => queryRunner,
      manager: { existsBy: jest.fn(() => Promise.resolve(false)) },
    } as unknown as DataSource,
    { sign } as unknown as JwtService,
    { enviarVerificacion } as unknown as CuentaCorreosService,
    { verificar: verificarGoogle } as unknown as GoogleAuthService,
  );

  const usuarioGuardado = () =>
    guardados.find((g) => g instanceof Usuario) as Usuario;

  return {
    servicio,
    orden,
    enviarVerificacion,
    sign,
    usuarioFindOne,
    usuarioUpdate,
    verificarGoogle,
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

    it('rechaza la contraseña en una cuenta creada con Google', async () => {
      const { servicio, usuarioFindOne } = preparar();
      usuarioFindOne.mockResolvedValue({
        id: 1,
        email: 'ana@correo.cl',
        passwordHash: null,
        activo: true,
      });

      await expect(
        servicio.login({ email: 'ana@correo.cl', password: 'secreto123' }),
      ).rejects.toThrow('Credenciales inválidas');
    });
  });

  describe('loginGoogle', () => {
    const cuenta = (extra: Partial<Usuario> = {}) =>
      ({
        id: 7,
        nombre: 'Ana',
        email: 'ana@correo.cl',
        passwordHash: 'hash',
        activo: true,
        emailVerificado: true,
        tokenVersion: 2,
        rol: { id: 1 },
        empresa: { id: 1 },
        ...extra,
      }) as unknown as Usuario;

    it('inicia sesión si la cuenta de Google ya está vinculada', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate, sign } = preparar();
      usuarioFindOne.mockResolvedValueOnce(cuenta());

      const respuesta = await servicio.loginGoogle('credential');

      expect(respuesta).toMatchObject({ accessToken: 'jwt-firmado' });
      expect(usuarioUpdate).not.toHaveBeenCalled();
      expect(sign.mock.calls[0][0]).toMatchObject({ sub: 7, tokenVersion: 2 });
    });

    it('vincula una cuenta verificada con el mismo email sin tocar la contraseña', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate } = preparar();
      usuarioFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cuenta());

      await servicio.loginGoogle('credential');

      const [criterio, cambios] = usuarioUpdate.mock.calls[0] as unknown as [
        { id: number },
        Partial<Usuario>,
      ];
      expect(criterio.id).toBe(7);
      expect(cambios).toMatchObject({
        googleId: 'google-123',
        emailVerificado: true,
      });
      expect(cambios).not.toHaveProperty('passwordHash');
    });

    it('al vincular una cuenta sin verificar borra la contraseña y cierra sesiones', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate, sign } = preparar();
      usuarioFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cuenta({ emailVerificado: false }));

      const respuesta = await servicio.loginGoogle('credential');

      const cambios = (usuarioUpdate.mock.calls[0] as unknown[])[1];
      expect(cambios).toMatchObject({ passwordHash: null, tokenVersion: 3 });
      expect(respuesta).toMatchObject({ user: { emailVerificado: true } });
      expect(sign.mock.calls[0][0]).toMatchObject({ tokenVersion: 3 });
    });

    it('no reemplaza otra cuenta de Google ya vinculada', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate } = preparar();
      usuarioFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(cuenta());
      usuarioUpdate.mockResolvedValue({ affected: 0 });

      await expect(servicio.loginGoogle('credential')).rejects.toThrow(
        'vinculado a otra cuenta de Google',
      );
    });

    it('pide registro si no existe la cuenta', async () => {
      const { servicio, sign } = preparar();

      const respuesta = await servicio.loginGoogle('credential');

      expect(respuesta).toEqual({
        requiereRegistro: true,
        perfil: { email: 'ana@correo.cl', nombre: 'Ana', apellido: 'Pérez' },
      });
      expect(sign).not.toHaveBeenCalled();
    });

    it('rechaza una cuenta desactivada', async () => {
      const { servicio, usuarioFindOne } = preparar();
      usuarioFindOne.mockResolvedValueOnce(cuenta({ activo: false }));

      await expect(servicio.loginGoogle('credential')).rejects.toThrow(
        'Cuenta desactivada',
      );
    });

    it('propaga el rechazo del token de Google', async () => {
      const { servicio, verificarGoogle } = preparar();
      verificarGoogle.mockRejectedValue(new Error('token inválido'));

      await expect(servicio.loginGoogle('credential')).rejects.toThrow(
        'token inválido',
      );
    });
  });

  describe('registroGoogle', () => {
    const dtoGoogle = {
      credential: 'credential',
      empresaNombre: 'Barbería Central',
    } as GoogleRegistroDto;

    it('crea la cuenta verificada, sin contraseña y sin enviar correo', async () => {
      const { servicio, usuarioGuardado, enviarVerificacion } = preparar();

      const respuesta = await servicio.registroGoogle(dtoGoogle);

      const usuario = usuarioGuardado();
      expect(usuario.email).toBe('ana@correo.cl');
      expect(usuario.nombre).toBe('Ana');
      expect(usuario.apellido).toBe('Pérez');
      expect(usuario.googleId).toBe('google-123');
      expect(usuario.passwordHash).toBeNull();
      expect(usuario.emailVerificado).toBe(true);
      expect(usuario.verificacionTokenHash).toBeUndefined();
      expect(enviarVerificacion).not.toHaveBeenCalled();
      expect(respuesta.accessToken).toBe('jwt-firmado');
      expect(respuesta.user.emailVerificado).toBe(true);
    });

    it('usa el nombre del formulario si viene', async () => {
      const { servicio, usuarioGuardado } = preparar();

      await servicio.registroGoogle({ ...dtoGoogle, nombre: 'Ana María' });

      expect(usuarioGuardado().nombre).toBe('Ana María');
    });

    it('rechaza si el email o la cuenta de Google ya existen', async () => {
      const { servicio, usuarioFindOne, usuarioGuardado } = preparar();
      usuarioFindOne.mockResolvedValueOnce({ id: 1 });

      await expect(servicio.registroGoogle(dtoGoogle)).rejects.toThrow(
        'Ya existe una cuenta con este email',
      );
      expect(usuarioGuardado()).toBeUndefined();
    });
  });

  /** SPEC 08: sesión del recepcionista (rol 2). */
  describe('recepcionista', () => {
    const recepcionista = (extra: Partial<Usuario> = {}) =>
      ({
        id: 20,
        nombre: 'Rocío',
        email: 'rocio@example.com',
        passwordHash: 'hash',
        activo: true,
        emailVerificado: true,
        tokenVersion: 1,
        rol: { id: 2 },
        empresa: { id: 1 },
        sucursal: { id: 10, nombre: 'Centro' },
        ...extra,
      }) as unknown as Usuario;

    /** AuthService con un empleado de OTRA sucursal que comparte el email. */
    function conEmpleado(usuario: Usuario | null) {
      const sign = jest.fn<string, [Record<string, unknown>]>(() => 'jwt');
      const usuarioFindOne = jest.fn(() => Promise.resolve(usuario));
      const usuarioUpdate = jest.fn(() => Promise.resolve({ affected: 1 }));
      const servicio = new AuthService(
        {
          findOne: usuarioFindOne,
          update: usuarioUpdate,
        } as unknown as Repository<Usuario>,
        {
          findOne: jest.fn(() =>
            Promise.resolve({
              id: 5,
              email: 'rocio@example.com',
              sucursal: { id: 99, empresa: { id: 1 } },
            }),
          ),
        } as unknown as Repository<Empleado>,
        {} as DataSource,
        { sign } as unknown as JwtService,
        {} as CuentaCorreosService,
        {
          verificar: jest.fn(() =>
            Promise.resolve({ ...perfilGoogle, email: 'rocio@example.com' }),
          ),
        } as unknown as GoogleAuthService,
      );
      return { servicio, sign, usuarioFindOne, usuarioUpdate };
    }

    it('sesionDe firma el JWT con la sucursal asignada, no la del empleado con su email', async () => {
      const { servicio, sign, usuarioFindOne } = conEmpleado(recepcionista());

      const respuesta = await servicio.sesionDe(20);

      expect(usuarioFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 20 },
          relations: { rol: true, empresa: true, sucursal: true },
        }),
      );
      expect(sign.mock.calls[0][0]).toMatchObject({
        sub: 20,
        rolId: 2,
        empresaId: 1,
        sucursalId: 10,
        tokenVersion: 1,
      });
      expect(respuesta.user).toMatchObject({
        rolId: 2,
        sucursal: { id: 10, nombre: 'Centro' },
      });
    });

    it('sin sucursal asignada el JWT no trae sucursalId (no accede a ninguna)', async () => {
      const { servicio, sign } = conEmpleado(recepcionista({ sucursal: null }));
      await servicio.sesionDe(20);
      expect(sign.mock.calls[0][0].sucursalId).toBeUndefined();
    });

    it('el dueño sigue tomando la sucursal del empleado y no recibe `sucursal`', async () => {
      const { servicio, sign } = conEmpleado(
        recepcionista({ rol: { id: 1 } as never, sucursal: null }),
      );
      const respuesta = await servicio.sesionDe(20);
      expect(sign.mock.calls[0][0].sucursalId).toBe(99);
      expect(respuesta.user).not.toHaveProperty('sucursal');
    });

    it('sesionDe rechaza un usuario desactivado', async () => {
      const { servicio } = conEmpleado(recepcionista({ activo: false }));
      await expect(servicio.sesionDe(20)).rejects.toThrow('Cuenta desactivada');
    });

    it('login con contraseña trae la sucursal del recepcionista', async () => {
      const { servicio, sign } = conEmpleado(
        recepcionista({ passwordHash: await bcrypt.hash('secreto123', 4) }),
      );
      await servicio.login({
        email: 'rocio@example.com',
        password: 'secreto123',
      });
      expect(sign.mock.calls[0][0]).toMatchObject({ sucursalId: 10 });
    });

    it('Google con la invitación pendiente → 401 y no vincula la cuenta', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate, sign } =
        conEmpleado(null);
      usuarioFindOne
        .mockResolvedValueOnce(null) // por googleId
        .mockResolvedValueOnce(
          recepcionista({ passwordHash: null, emailVerificado: false }),
        );

      await expect(servicio.loginGoogle('credential')).rejects.toThrow(
        'Acepta la invitación que llegó a tu correo antes de entrar con Google',
      );
      expect(usuarioUpdate).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    });

    it('Google después de aceptar la invitación vincula y entra con su sucursal', async () => {
      const { servicio, usuarioFindOne, usuarioUpdate, sign } =
        conEmpleado(null);
      usuarioFindOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(recepcionista());

      await servicio.loginGoogle('credential');

      expect(usuarioUpdate).toHaveBeenCalled();
      expect(sign.mock.calls[0][0]).toMatchObject({ rolId: 2, sucursalId: 10 });
    });
  });
});
