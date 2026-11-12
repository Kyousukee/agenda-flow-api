import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  Repository,
} from 'typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import {
  DIAS_AVISO,
  LIMITES_PLAN,
  PlanSuscripcion,
  RECURSOS_LIMITADOS,
  RecursoLimitado,
} from './planes';
import { SuscripcionLimiteException } from './suscripcion-limite.exception';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface ResumenSuscripcion {
  plan: PlanSuscripcion;
  sinVencimiento: boolean;
  fechaFin: Date | null;
  diasRestantes: number | null;
  porVencer: boolean;
  aviso: string | null;
  limites: Record<RecursoLimitado, number | null>; // null = ilimitado
  uso: Record<RecursoLimitado, number>;
}

type EntidadLimitada = typeof Sucursal | typeof Empleado | typeof Servicio;
type FiltroRecurso = { activo?: boolean; desactivadoPorSuscripcion?: boolean };

const ENTIDAD_POR_RECURSO: Record<RecursoLimitado, EntidadLimitada> = {
  sucursales: Sucursal,
  empleados: Empleado,
  servicios: Servicio,
};

@Injectable()
export class SuscripcionesService {
  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepo: Repository<Suscripcion>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Único punto que resuelve el plan vigente de una empresa (SPEC 01, reglas 1-6).
   * Aplica de forma perezosa la degradación por vencimiento y la reactivación
   * del excedente al volver a un plan ilimitado.
   */
  async obtenerVigente(empresaId: number): Promise<Suscripcion> {
    let suscripcion = await this.suscripcionRepo.findOne({ where: { empresaId } });

    // Regla 6: caso defensivo, empresa sin fila de suscripción.
    if (!suscripcion) {
      suscripcion = await this.suscripcionRepo.save(
        this.suscripcionRepo.create({
          empresaId,
          plan: 'Gratis',
          fechaInicio: new Date(),
          fechaFin: null,
          excedenteDesactivado: false,
        }),
      );
    }

    // Reglas 1-2: Pro sin fecha, o Prueba/Pro con FechaFin futura -> vigente, nada que hacer.
    // Regla 3: Prueba/Pro con FechaFin pasada -> degradar a Gratis.
    if (
      (suscripcion.plan === 'Prueba' || suscripcion.plan === 'Pro') &&
      suscripcion.fechaFin !== null &&
      suscripcion.fechaFin.getTime() < Date.now()
    ) {
      suscripcion = await this.degradar(suscripcion);
    }

    // Regla 5: plan ilimitado con excedente pendiente de reactivar.
    if (suscripcion.plan !== 'Gratis' && suscripcion.excedenteDesactivado) {
      suscripcion = await this.reactivarExcedente(suscripcion);
    }

    // Regla 4: Gratis -> se devuelve tal cual; los límites los aplica quien consulta.
    return suscripcion;
  }

  /** Pasa a Gratis y desactiva lo más reciente que supere los límites de Gratis. */
  private async degradar(suscripcion: Suscripcion): Promise<Suscripcion> {
    await this.dataSource.transaction(async (manager) => {
      // Update condicional: si otro request ya degradó, no se repite el trabajo.
      // (update() con criterios: TypeORM escapa [Plan], que es palabra reservada en T-SQL)
      const resultado = await manager
        .getRepository(Suscripcion)
        .update(
          { id: suscripcion.id, plan: In(['Prueba', 'Pro']) },
          { plan: 'Gratis', fechaFin: null, excedenteDesactivado: true },
        );

      if (!resultado.affected) {
        return;
      }

      for (const recurso of RECURSOS_LIMITADOS) {
        const limite = LIMITES_PLAN.Gratis[recurso];
        if (limite === null) continue;

        const idsActivos = await this.idsActivos(manager, recurso, suscripcion.empresaId);
        const excedente = idsActivos.slice(limite); // se conservan los N de menor Id
        if (excedente.length > 0) {
          await manager.getRepository(ENTIDAD_POR_RECURSO[recurso]).update(
            { id: In(excedente) },
            { activo: false, desactivadoPorSuscripcion: true },
          );
        }
      }
    });

    return this.suscripcionRepo.findOneOrFail({ where: { id: suscripcion.id } });
  }

  /** Reactiva exactamente lo que desactivó la suscripción (no lo desactivado a mano). */
  private async reactivarExcedente(suscripcion: Suscripcion): Promise<Suscripcion> {
    await this.dataSource.transaction(async (manager) => {
      for (const recurso of RECURSOS_LIMITADOS) {
        const ids = await this.idsDesactivadosPorSuscripcion(
          manager,
          recurso,
          suscripcion.empresaId,
        );
        if (ids.length > 0) {
          await manager.getRepository(ENTIDAD_POR_RECURSO[recurso]).update(
            { id: In(ids) },
            { activo: true, desactivadoPorSuscripcion: false },
          );
        }
      }

      await manager.getRepository(Suscripcion).update(
        { id: suscripcion.id },
        { excedenteDesactivado: false },
      );
    });

    return this.suscripcionRepo.findOneOrFail({ where: { id: suscripcion.id } });
  }

  /** Ids activos (Activo = 1) del recurso para la empresa, ordenados por Id ascendente. */
  private async idsActivos(
    manager: EntityManager,
    recurso: RecursoLimitado,
    empresaId: number,
  ): Promise<number[]> {
    return this.buscarIds(manager, recurso, empresaId, { activo: true });
  }

  /** Ids marcados con DesactivadoPorSuscripcion = 1 del recurso para la empresa. */
  private async idsDesactivadosPorSuscripcion(
    manager: EntityManager,
    recurso: RecursoLimitado,
    empresaId: number,
  ): Promise<number[]> {
    return this.buscarIds(manager, recurso, empresaId, { desactivadoPorSuscripcion: true });
  }

  private async buscarIds(
    manager: EntityManager,
    recurso: RecursoLimitado,
    empresaId: number,
    filtro: FiltroRecurso,
  ): Promise<number[]> {
    const filas: { id: number }[] = await manager
      .getRepository<{ id: number }>(ENTIDAD_POR_RECURSO[recurso])
      .find({
        select: { id: true },
        where: this.whereRecurso(recurso, empresaId, filtro),
        order: { id: 'ASC' },
      });
    return filas.map((f) => f.id);
  }

  /**
   * SPEC 06: un pago de la mensualidad extiende Pro con la regla de suscripcion-pro-extender.sql.
   * Si la Prueba o el Pro siguen vigentes, los días se suman desde su FechaFin (pagar antes
   * no hace perder días); si está en Gratis o ya venció, desde ahora. Un Pro sin vencimiento
   * no se toca (finNuevo = null). Volver de Gratis reactiva el excedente en la próxima
   * llamada a obtenerVigente (regla 5).
   */
  async extenderPro(
    empresaId: number,
    dias: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<{ finAnterior: Date | null; finNuevo: Date | null }> {
    const suscripcion = await manager.findOne(Suscripcion, {
      where: { empresaId },
    });
    const finAnterior = suscripcion?.fechaFin ?? null;
    if (suscripcion?.plan === 'Pro' && suscripcion.fechaFin === null) {
      return { finAnterior, finNuevo: null };
    }

    const ahora = new Date();
    const vigente =
      (suscripcion?.plan === 'Prueba' || suscripcion?.plan === 'Pro') &&
      finAnterior !== null &&
      finAnterior.getTime() > ahora.getTime();
    const base = vigente ? finAnterior : ahora;
    const finNuevo = new Date(base.getTime() + dias * MS_POR_DIA);

    if (suscripcion) {
      await manager.update(
        Suscripcion,
        { empresaId },
        { plan: 'Pro', fechaFin: finNuevo },
      );
    } else {
      await manager.save(
        manager.create(Suscripcion, {
          empresaId,
          plan: 'Pro',
          fechaInicio: ahora,
          fechaFin: finNuevo,
          excedenteDesactivado: false,
        }),
      );
    }
    return { finAnterior, finNuevo };
  }

  /** Cuenta los registros activos (Activo = 1) del recurso para la empresa. */
  async contarActivos(empresaId: number, recurso: RecursoLimitado): Promise<number> {
    return this.dataSource
      .getRepository<{ id: number }>(ENTIDAD_POR_RECURSO[recurso])
      .count({ where: this.whereRecurso(recurso, empresaId, { activo: true }) });
  }

  /**
   * Lanza SuscripcionLimiteException (403) si el plan vigente no permite
   * tener un registro activo más del recurso indicado.
   */
  async validarLimite(empresaId: number, recurso: RecursoLimitado): Promise<void> {
    const suscripcion = await this.obtenerVigente(empresaId);
    const limite = LIMITES_PLAN[suscripcion.plan][recurso];
    if (limite === null) return;

    const actual = await this.contarActivos(empresaId, recurso);
    if (actual >= limite) {
      throw new SuscripcionLimiteException(suscripcion.plan, recurso, limite, actual);
    }
  }

  /** Respuesta de GET /suscripcion: plan vigente, vencimiento, aviso y uso vs límites. */
  async obtenerResumen(empresaId: number): Promise<ResumenSuscripcion> {
    const suscripcion = await this.obtenerVigente(empresaId);
    const { plan, fechaFin } = suscripcion;

    const msRestantes = fechaFin ? fechaFin.getTime() - Date.now() : null;
    const diasRestantes = msRestantes === null ? null : Math.ceil(msRestantes / MS_POR_DIA);
    const porVencer = diasRestantes !== null && diasRestantes <= DIAS_AVISO;

    const uso = {} as Record<RecursoLimitado, number>;
    for (const recurso of RECURSOS_LIMITADOS) {
      uso[recurso] = await this.contarActivos(empresaId, recurso);
    }

    return {
      plan,
      sinVencimiento: plan === 'Pro' && fechaFin === null,
      fechaFin,
      diasRestantes,
      porVencer,
      aviso: this.construirAviso(plan, porVencer, msRestantes, diasRestantes),
      limites: LIMITES_PLAN[plan],
      uso,
    };
  }

  private construirAviso(
    plan: PlanSuscripcion,
    porVencer: boolean,
    msRestantes: number | null,
    diasRestantes: number | null,
  ): string | null {
    if (plan === 'Gratis') {
      return 'Estás en el plan Gratis. Actualiza a Pro para quitar los límites.';
    }
    if (!porVencer || msRestantes === null || diasRestantes === null) {
      return null;
    }

    // Menos de 24 h: "vence hoy" en lugar de "vence en 1 día".
    const cuando =
      msRestantes < MS_POR_DIA
        ? 'vence hoy'
        : `vence en ${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'}`;

    return plan === 'Prueba'
      ? `Tu prueba gratuita ${cuando}. Contáctanos para activar el plan Pro.`
      : `Tu plan Pro ${cuando}. Contáctanos para renovarlo.`;
  }

  /** Filtro por empresa de cada recurso. Los empleados se cuentan a nivel de empresa. */
  private whereRecurso(
    recurso: RecursoLimitado,
    empresaId: number,
    filtro: FiltroRecurso,
  ): FindOptionsWhere<{ id: number }> {
    const where =
      recurso === 'empleados'
        ? { ...filtro, sucursal: { empresa: { id: empresaId } } }
        : { ...filtro, empresa: { id: empresaId } };
    return where as FindOptionsWhere<{ id: number }>;
  }
}
