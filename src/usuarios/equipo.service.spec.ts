import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { EquipoService, invitacionPendiente } from './equipo.service';
import { Usuario } from './entities/usuario.entity';
import { SuscripcionLimiteException } from '../suscripciones/suscripcion-limite.exception';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from '../auth/roles';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EquipoController } from './equipo.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

const EMPRESA = 1;
const dueno: JwtPayload = {
  sub: 1,
  email: 'dueno@barberia.cl',
  rolId: ROL_ADMIN,
  empresaId: EMPRESA,
};

const recepcionista = (over: Partial<Usuario> = {}): Usuario =>
  ({
    id: 20,
    nombre: 'Rocío',
    apellido: null,
    email: 'rocio@example.com',
    passwordHash: null,
    googleId: null,
    emailVerificado: false,
    activo: true,
    desactivadoPorSuscripcion: false,
    tokenVersion: 0,
    sucursal: { id: 10, nombre: 'Centro' },
    ...over,
  }) as unknown as Usuario;

function montar(
  opciones: {
    miembro?: Usuario | null;
    sucursal?: unknown;
    emailEnUso?: boolean;
    limite?: Error;
    token?: string | null;
    save?: jest.Mock;
  } = {},
) {
  let miembro = 'miembro' in opciones ? opciones.miembro : recepcionista();
  const usuarioRepo = {
    find: jest.fn().mockResolvedValue([recepcionista()]),
    findOne: jest.fn((o: { where: { id: number } }) =>
      Promise.resolve(
        o.where.id === dueno.sub ? { id: 1, nombre: 'José' } : miembro,
      ),
    ),
    exists: jest.fn().mockResolvedValue(opciones.emailEnUso ?? false),
    create: jest.fn((d: object) => d),
    save:
      opciones.save ??
      jest.fn((d: object) => {
        miembro = {
          ...recepcionista(),
          ...d,
          // Al releer, la sucursal viene con su nombre (como desde la BD).
          sucursal: recepcionista().sucursal,
          id: 20,
        };
        return Promise.resolve(miembro);
      }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const sucursal =
    'sucursal' in opciones
      ? opciones.sucursal
      : { id: 10, nombre: 'Centro', activo: true, empresa: { id: EMPRESA } };
  const sucursalRepo = { findOne: jest.fn().mockResolvedValue(sucursal) };
  const empresaRepo = {
    findOne: jest.fn().mockResolvedValue({
      nombre: 'Barbería SpA',
      nombreComercial: 'Barbería',
    }),
  };
  const estadoRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 8, nombre: 'Activo' }),
  };
  const suscripciones = {
    validarLimite: opciones.limite
      ? jest.fn().mockRejectedValue(opciones.limite)
      : jest.fn().mockResolvedValue(undefined),
  };
  const cuenta = {
    prepararInvitacion: jest
      .fn()
      .mockResolvedValue('token' in opciones ? opciones.token : 'tok-claro'),
  };
  const correos = { enviarInvitacion: jest.fn().mockResolvedValue(true) };
  const service = new EquipoService(
    usuarioRepo as never,
    sucursalRepo as never,
    empresaRepo as never,
    estadoRepo as never,
    suscripciones as never,
    cuenta as never,
    correos as never,
  );
  return { service, usuarioRepo, suscripciones, cuenta, correos };
}

const nuevo = {
  nombre: 'Rocío',
  email: '  Rocio@Example.com ',
  sucursalId: 10,
};

/** Evalúa la expresión `() => 'TokenVersion + 1'` que se pasa a TypeORM. */
const subeTokenVersion = (cambios: Record<string, unknown>) =>
  typeof cambios.tokenVersion === 'function' &&
  (cambios.tokenVersion as () => string)() === 'TokenVersion + 1';

describe('EquipoService (SPEC 08)', () => {
  describe('invitar', () => {
    it('crea un usuario rol 2 sin contraseña, en la sucursal, y envía la invitación', async () => {
      const { service, usuarioRepo, suscripciones, cuenta, correos } = montar();

      const res = await service.invitar(dueno, nuevo);

      expect(suscripciones.validarLimite).toHaveBeenCalledWith(
        EMPRESA,
        'recepcionistas',
      );
      expect(usuarioRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'rocio@example.com',
          passwordHash: null,
          emailVerificado: false,
          activo: true,
          empresa: { id: EMPRESA },
          rol: { id: ROL_RECEPCIONISTA },
          sucursal: { id: 10 },
        }),
      );
      expect(cuenta.prepararInvitacion).toHaveBeenCalled();
      expect(correos.enviarInvitacion).toHaveBeenCalledWith(
        { nombre: 'Rocío', email: 'rocio@example.com' },
        'tok-claro',
        { empresa: 'Barbería', sucursal: 'Centro', invitadoPor: 'José' },
      );
      expect(res).toEqual(
        expect.objectContaining({
          id: 20,
          email: 'rocio@example.com',
          sucursal: { id: 10, nombre: 'Centro' },
          invitacionPendiente: true,
          activo: true,
        }),
      );
      expect(res).not.toHaveProperty('passwordHash');
    });

    it('en plan Gratis responde el 403 de límite y no crea nada', async () => {
      const limite = new SuscripcionLimiteException(
        'Gratis',
        'recepcionistas',
        0,
        0,
      );
      const { service, usuarioRepo, correos } = montar({ limite });
      await expect(service.invitar(dueno, nuevo)).rejects.toBe(limite);
      expect(usuarioRepo.save).not.toHaveBeenCalled();
      expect(correos.enviarInvitacion).not.toHaveBeenCalled();
    });

    it('un email que ya tiene cuenta → 409', async () => {
      const { service, usuarioRepo } = montar({ emailEnUso: true });
      await expect(service.invitar(dueno, nuevo)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(usuarioRepo.save).not.toHaveBeenCalled();
    });

    it('la violación del índice único (invitación simultánea) también → 409', async () => {
      const save = jest
        .fn()
        .mockRejectedValue({ driverError: { number: 2627 } });
      const { service } = montar({ save });
      await expect(service.invitar(dueno, nuevo)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('una sucursal de otra empresa o inactiva → 400', async () => {
      const ajena = montar({
        sucursal: { id: 10, activo: true, empresa: { id: 2 } },
      });
      await expect(ajena.service.invitar(dueno, nuevo)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const inactiva = montar({
        sucursal: { id: 10, activo: false, empresa: { id: EMPRESA } },
      });
      await expect(
        inactiva.service.invitar(dueno, nuevo),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listar', () => {
    it('filtra recepcionistas de la empresa e informa la invitación pendiente', async () => {
      const { service, usuarioRepo } = montar();
      const lista = await service.listar(dueno);
      expect(usuarioRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresa: { id: EMPRESA }, rol: { id: ROL_RECEPCIONISTA } },
        }),
      );
      expect(lista).toEqual([
        {
          id: 20,
          nombre: 'Rocío',
          apellido: null,
          email: 'rocio@example.com',
          sucursal: { id: 10, nombre: 'Centro' },
          activo: true,
          invitacionPendiente: true,
          desactivadoPorSuscripcion: false,
        },
      ]);
    });
  });

  describe('invitacionPendiente', () => {
    it('deja de estar pendiente con contraseña, con Google o con el email verificado', () => {
      expect(invitacionPendiente(recepcionista())).toBe(true);
      expect(invitacionPendiente(recepcionista({ passwordHash: 'h' }))).toBe(
        false,
      );
      expect(invitacionPendiente(recepcionista({ googleId: 'g' }))).toBe(false);
      expect(
        invitacionPendiente(recepcionista({ emailVerificado: true })),
      ).toBe(false);
    });
  });

  describe('actualizar', () => {
    it('cambiar la sucursal sube TokenVersion', async () => {
      const { service, usuarioRepo } = montar({
        sucursal: {
          id: 11,
          nombre: 'Norte',
          activo: true,
          empresa: { id: EMPRESA },
        },
      });

      await service.actualizar(dueno, 20, { sucursalId: 11 });

      const [criterio, cambios] = usuarioRepo.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(criterio).toEqual({ id: 20 });
      expect(cambios.sucursal).toEqual({ id: 11 });
      expect(subeTokenVersion(cambios)).toBe(true);
    });

    it('la misma sucursal no cierra la sesión', async () => {
      const { service, usuarioRepo } = montar();
      await service.actualizar(dueno, 20, { sucursalId: 10, nombre: 'Ro' });
      const [, cambios] = usuarioRepo.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(cambios).toEqual({ nombre: 'Ro' });
    });

    it('desactivar sube TokenVersion y no lo marca como excedente del plan', async () => {
      const { service, usuarioRepo } = montar();
      await service.actualizar(dueno, 20, { activo: false });
      const [, cambios] = usuarioRepo.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(cambios).toEqual(
        expect.objectContaining({
          activo: false,
          desactivadoPorSuscripcion: false,
        }),
      );
      expect(subeTokenVersion(cambios)).toBe(true);
    });

    it('reactivar valida el límite del plan', async () => {
      const limite = new SuscripcionLimiteException(
        'Gratis',
        'recepcionistas',
        0,
        0,
      );
      const { service, usuarioRepo } = montar({
        miembro: recepcionista({ activo: false }),
        limite,
      });
      await expect(
        service.actualizar(dueno, 20, { activo: true }),
      ).rejects.toBe(limite);
      expect(usuarioRepo.update).not.toHaveBeenCalled();
    });

    it('reactivar en Pro lo deja activo sin tocar TokenVersion', async () => {
      const { service, usuarioRepo } = montar({
        miembro: recepcionista({
          activo: false,
          desactivadoPorSuscripcion: true,
        }),
      });
      await service.actualizar(dueno, 20, { activo: true });
      const [, cambios] = usuarioRepo.update.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(cambios).toEqual({
        activo: true,
        desactivadoPorSuscripcion: false,
      });
    });

    it('un usuario que no es recepcionista de la empresa → 404', async () => {
      const { service, usuarioRepo } = montar({ miembro: null });
      await expect(
        service.actualizar(dueno, 99, { nombre: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(usuarioRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('reenviarInvitacion', () => {
    it('genera un token nuevo y reenvía el correo', async () => {
      const { service, cuenta, correos } = montar();
      await service.reenviarInvitacion(dueno, 20);
      expect(cuenta.prepararInvitacion).toHaveBeenCalled();
      expect(correos.enviarInvitacion).toHaveBeenCalled();
    });

    it('si el límite de envíos no lo permite → 429', async () => {
      const { service, correos } = montar({ token: null });
      const error = await service
        .reenviarInvitacion(dueno, 20)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(correos.enviarInvitacion).not.toHaveBeenCalled();
    });

    it('una invitación ya aceptada → 409', async () => {
      const { service, cuenta } = montar({
        miembro: recepcionista({ passwordHash: 'h', emailVerificado: true }),
      });
      await expect(
        service.reenviarInvitacion(dueno, 20),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(cuenta.prepararInvitacion).not.toHaveBeenCalled();
    });

    it('un recepcionista desactivado → 409', async () => {
      const { service } = montar({ miembro: recepcionista({ activo: false }) });
      await expect(
        service.reenviarInvitacion(dueno, 20),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('el controlador /equipo es solo para el rol 1', () => {
    expect(Reflect.getMetadata(ROLES_KEY, EquipoController)).toEqual([
      ROL_ADMIN,
    ]);
    for (const metodo of Object.getOwnPropertyNames(
      EquipoController.prototype,
    ).filter((m) => m !== 'constructor')) {
      const fn = Object.getOwnPropertyDescriptor(
        EquipoController.prototype,
        metodo,
      )!.value as object;
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
    }
  });
});
