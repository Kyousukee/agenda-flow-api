import { In } from 'typeorm';
import { SuscripcionesService } from './suscripciones.service';
import { Suscripcion } from './entities/suscripcion.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { LIMITES_PLAN, RECURSOS_LIMITADOS } from './planes';
import {
  SUSCRIPCION_LIMITE,
  SuscripcionLimiteException,
} from './suscripcion-limite.exception';
import { ROL_RECEPCIONISTA } from '../auth/roles';

/** SPEC 08: recurso limitado `recepcionistas` (Gratis 0, Prueba/Pro ilimitado). */

const EMPRESA = 1;
const DIA = 24 * 60 * 60 * 1000;

type Repo = { find: jest.Mock; update: jest.Mock; count: jest.Mock };

function montar(
  suscripcion: Partial<Suscripcion>,
  ids: Partial<Record<'activos' | 'desactivados', number[]>> = {},
) {
  const repos = new Map<unknown, Repo>();
  const repo = (entidad: unknown): Repo => {
    if (!repos.has(entidad)) {
      repos.set(entidad, {
        // Solo los recepcionistas tienen filas: el resto del excedente queda vacío.
        find: jest.fn((opciones: { where: Record<string, unknown> }) => {
          if (entidad !== Usuario) return Promise.resolve([]);
          const lista = opciones.where.activo
            ? (ids.activos ?? [])
            : (ids.desactivados ?? []);
          return Promise.resolve(lista.map((id) => ({ id })));
        }),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        count: jest.fn().mockResolvedValue((ids.activos ?? []).length),
      });
    }
    return repos.get(entidad)!;
  };
  const manager = { getRepository: jest.fn(repo) };
  const dataSource = {
    transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
    getRepository: jest.fn(repo),
  };
  const fila = { id: 50, empresaId: EMPRESA, ...suscripcion };
  const suscripcionRepo = {
    findOne: jest.fn().mockResolvedValue(fila),
    findOneOrFail: jest.fn().mockResolvedValue({
      ...fila,
      plan: suscripcion.plan === 'Gratis' ? 'Gratis' : fila.plan,
    }),
  };
  const service = new SuscripcionesService(
    suscripcionRepo as never,
    dataSource as never,
  );
  return { service, repo, suscripcionRepo };
}

describe('Límite de recepcionistas por plan (SPEC 08)', () => {
  it('Gratis no incluye recepcionistas; Prueba y Pro son ilimitados', () => {
    expect(RECURSOS_LIMITADOS).toContain('recepcionistas');
    expect(LIMITES_PLAN.Gratis.recepcionistas).toBe(0);
    expect(LIMITES_PLAN.Prueba.recepcionistas).toBeNull();
    expect(LIMITES_PLAN.Pro.recepcionistas).toBeNull();
  });

  it('bajar de Pro a Gratis desactiva a todos los recepcionistas y corta sus sesiones', async () => {
    const { service, repo } = montar(
      { plan: 'Pro', fechaFin: new Date(Date.now() - DIA) },
      { activos: [4, 9] },
    );

    await service.obtenerVigente(EMPRESA);

    const usuarios = repo(Usuario);
    expect(usuarios.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activo: true,
          empresa: { id: EMPRESA },
          rol: { id: ROL_RECEPCIONISTA },
        },
      }),
    );
    expect(usuarios.update).toHaveBeenCalledTimes(1);
    const [criterio, cambios] = usuarios.update.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(criterio).toEqual({ id: In([4, 9]) });
    expect(cambios).toEqual(
      expect.objectContaining({
        activo: false,
        desactivadoPorSuscripcion: true,
      }),
    );
    expect((cambios.tokenVersion as () => string)()).toBe('TokenVersion + 1');
  });

  it('el excedente de los otros recursos no toca TokenVersion', async () => {
    const { service, repo } = montar({
      plan: 'Pro',
      fechaFin: new Date(Date.now() - DIA),
    });
    // Sucursales con 2 activas: la segunda es excedente en Gratis.
    repo(Sucursal).find.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.obtenerVigente(EMPRESA);

    expect(repo(Sucursal).update).toHaveBeenCalledWith(
      { id: In([2]) },
      { activo: false, desactivadoPorSuscripcion: true },
    );
    expect(repo(Usuario).update).not.toHaveBeenCalled();
  });

  it('volver a Pro reactiva a los recepcionistas desactivados por el plan', async () => {
    const { service, repo } = montar(
      { plan: 'Pro', fechaFin: null, excedenteDesactivado: true },
      { desactivados: [4, 9] },
    );

    await service.obtenerVigente(EMPRESA);

    const usuarios = repo(Usuario);
    expect(usuarios.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          desactivadoPorSuscripcion: true,
          empresa: { id: EMPRESA },
          rol: { id: ROL_RECEPCIONISTA },
        },
      }),
    );
    expect(usuarios.update).toHaveBeenCalledWith(
      { id: In([4, 9]) },
      { activo: true, desactivadoPorSuscripcion: false },
    );
  });

  it('validarLimite en Gratis rechaza el primer recepcionista con el 403 de límite', async () => {
    const { service } = montar({ plan: 'Gratis', fechaFin: null });

    const error = await service
      .validarLimite(EMPRESA, 'recepcionistas')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SuscripcionLimiteException);
    const cuerpo = (error as SuscripcionLimiteException).getResponse();
    expect(cuerpo).toEqual(
      expect.objectContaining({
        code: SUSCRIPCION_LIMITE,
        recurso: 'recepcionistas',
        limite: 0,
        message:
          'Tu plan Gratis no incluye recepcionistas. Actualiza a Pro para agregarlos.',
      }),
    );
  });

  it('validarLimite en Pro deja pasar', async () => {
    const { service } = montar({
      plan: 'Pro',
      fechaFin: new Date(Date.now() + DIA),
    });
    await expect(
      service.validarLimite(EMPRESA, 'recepcionistas'),
    ).resolves.toBeUndefined();
  });

  it('el resumen informa límite y uso de recepcionistas', async () => {
    const { service, repo } = montar(
      { plan: 'Pro', fechaFin: new Date(Date.now() + 10 * DIA) },
      { activos: [4, 9, 12] },
    );

    const resumen = await service.obtenerResumen(EMPRESA);

    expect(resumen.limites.recepcionistas).toBeNull();
    expect(resumen.uso.recepcionistas).toBe(3);
    expect(repo(Usuario).count).toHaveBeenCalledWith({
      where: {
        activo: true,
        empresa: { id: EMPRESA },
        rol: { id: ROL_RECEPCIONISTA },
      },
    });
    // Los otros recursos siguen contando sobre su propia entidad.
    for (const entidad of [Sucursal, Empleado, Servicio]) {
      expect(repo(entidad).count).toHaveBeenCalled();
    }
  });
});
