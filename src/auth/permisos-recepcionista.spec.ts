// uuid es ESM; los specs del repo lo reemplazan (ver reservas.service.spec.ts).
jest.mock('uuid', () => ({ v4: () => 'uuid-de-prueba' }));

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { ROL_ADMIN, ROL_RECEPCIONISTA } from './roles';
import { EmpleadosController } from '../empleados/empleados.controller';
import { ServiciosController } from '../servicios/servicios.controller';
import { HorariosController } from '../horarios/horarios.controller';
import { BloqueosController } from '../bloqueos/bloqueos.controller';
import { SucursalesController } from '../sucursales/sucursales.controller';
import { ConfiguracionEmpresaController } from '../configuracion-empresa/configuracion-empresa.controller';
import { CuentasFlowController } from '../flow/cuentas-flow.controller';
import { SuscripcionesController } from '../suscripciones/suscripciones.controller';
import { PagosController } from '../pagos/pagos.controller';
import { ReservasController } from '../reservas/reservas.controller';
import { EquipoController } from '../usuarios/equipo.controller';

/** SPEC 08: el RolesGuard real decide sobre los metadatos de cada endpoint. */
type Clase = abstract new (...args: never[]) => object;

function contexto(clase: Clase, metodo: string, rolId: number) {
  const handler = Object.getOwnPropertyDescriptor(clase.prototype, metodo)!
    .value as () => unknown;
  return {
    getHandler: () => handler,
    getClass: () => clase,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { sub: 1, email: 'x', rolId, empresaId: 1, sucursalId: 10 },
      }),
    }),
  } as unknown as ExecutionContext;
}

function metodos(clase: Clase): string[] {
  return Object.getOwnPropertyNames(clase.prototype).filter(
    (m) => m !== 'constructor',
  );
}

const guard = new RolesGuard(new Reflector());

describe('Permisos del recepcionista (SPEC 08)', () => {
  const soloAdmin: [string, Clase][] = [
    ['empleados', EmpleadosController],
    ['servicios', ServiciosController],
    ['horarios', HorariosController],
    ['bloqueos', BloqueosController],
    ['sucursales', SucursalesController],
    ['configuración', ConfiguracionEmpresaController],
    ['cuentas Flow', CuentasFlowController],
    ['suscripción', SuscripcionesController],
    ['equipo', EquipoController],
  ];

  it.each(soloAdmin)(
    '%s: todos los endpoints responden 403 al rol 2 y dejan pasar al rol 1',
    (_nombre, clase) => {
      const lista = metodos(clase);
      expect(lista.length).toBeGreaterThan(0);
      for (const metodo of lista) {
        expect(() =>
          guard.canActivate(contexto(clase, metodo, ROL_RECEPCIONISTA)),
        ).toThrow(ForbiddenException);
        expect(guard.canActivate(contexto(clase, metodo, ROL_ADMIN))).toBe(
          true,
        );
      }
    },
  );

  it('pagos: reembolsos solo para el rol 1; ver, registrar y cambiar estado para ambos', () => {
    for (const metodo of ['reembolsar', 'listarReembolsos']) {
      expect(() =>
        guard.canActivate(contexto(PagosController, metodo, ROL_RECEPCIONISTA)),
      ).toThrow(ForbiddenException);
    }
    for (const metodo of [
      'findAll',
      'obtenerEstados',
      'create',
      'actualizarEstado',
    ]) {
      expect(
        guard.canActivate(contexto(PagosController, metodo, ROL_RECEPCIONISTA)),
      ).toBe(true);
    }
  });

  it('reservas: todos los endpoints abiertos al rol 2', () => {
    for (const metodo of metodos(ReservasController)) {
      expect(
        guard.canActivate(
          contexto(ReservasController, metodo, ROL_RECEPCIONISTA),
        ),
      ).toBe(true);
    }
  });
});
