import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { CuentaFlow } from './entities/cuenta-flow.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { CifradoCredenciales } from './cifrado';
import { CredencialesFlow } from './flow.client';
import { GuardarCuentaFlowDto } from './dto/guardar-cuenta-flow.dto';

export interface ResumenCuentaFlow {
  configurada: boolean;
  /** Últimos 4 caracteres del apiKey, o null si no hay cuenta. */
  apiKeyFinal: string | null;
}

export interface CuentaFlowSucursal {
  sucursalId: number;
  nombre: string | null;
  activa: boolean;
  cuentaPropia: boolean;
  apiKeyFinal: string | null;
  usaCuentaEmpresa: boolean;
}

export interface CuentasFlowEmpresa {
  empresa: ResumenCuentaFlow;
  sucursales: CuentaFlowSucursal[];
}

function final(apiKey: string): string {
  return apiKey.slice(-4);
}

/**
 * SPEC 06: cuentas Flow de los locales. Una por empresa (`sucursalId = null`) y,
 * opcionalmente, una propia por sucursal. Quitar o reemplazar es una baja lógica:
 * la fila se conserva para verificar los pagos que firmó.
 */
@Injectable()
export class CuentasFlowService {
  constructor(
    @InjectRepository(CuentaFlow)
    private readonly cuentaRepo: Repository<CuentaFlow>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly dataSource: DataSource,
    private readonly cifrado: CifradoCredenciales,
  ) {}

  /** Lo que ve el panel. Nunca incluye la secretKey. */
  async listar(empresaId: number): Promise<CuentasFlowEmpresa> {
    const [vigentes, sucursales] = await Promise.all([
      this.cuentaRepo.find({ where: { empresaId, fechaBaja: IsNull() } }),
      this.sucursalRepo.find({
        where: { empresa: { id: empresaId } },
        order: { id: 'ASC' },
      }),
    ]);

    const deEmpresa = vigentes.find((c) => c.sucursalId === null);
    const porSucursal = new Map(
      vigentes
        .filter((c) => c.sucursalId !== null)
        .map((c) => [c.sucursalId, c]),
    );

    return {
      empresa: {
        configurada: !!deEmpresa,
        apiKeyFinal: deEmpresa ? final(deEmpresa.apiKey) : null,
      },
      sucursales: sucursales.map((s) => {
        const propia = porSucursal.get(s.id);
        return {
          sucursalId: s.id,
          nombre: s.nombre ?? null,
          activa: s.activo !== false,
          cuentaPropia: !!propia,
          apiKeyFinal: propia ? final(propia.apiKey) : null,
          usaCuentaEmpresa: !propia && !!deEmpresa,
        };
      }),
    };
  }

  guardarEmpresa(
    empresaId: number,
    dto: GuardarCuentaFlowDto,
  ): Promise<ResumenCuentaFlow> {
    return this.guardar(empresaId, null, dto);
  }

  async guardarSucursal(
    empresaId: number,
    sucursalId: number,
    dto: GuardarCuentaFlowDto,
  ): Promise<ResumenCuentaFlow> {
    await this.validarSucursal(empresaId, sucursalId);
    return this.guardar(empresaId, sucursalId, dto);
  }

  async quitarEmpresa(empresaId: number): Promise<void> {
    await this.darDeBaja(this.cuentaRepo.manager, empresaId, null);
  }

  async quitarSucursal(empresaId: number, sucursalId: number): Promise<void> {
    await this.validarSucursal(empresaId, sucursalId);
    await this.darDeBaja(this.cuentaRepo.manager, empresaId, sucursalId);
  }

  /** Cuenta vigente que cobra en esa sucursal: la propia o, si no tiene, la de la empresa. */
  async resolver(sucursalId: number): Promise<CuentaFlow | null> {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal?.empresa) {
      return null;
    }
    const vigentes = await this.cuentaRepo.find({
      where: [
        { sucursalId, fechaBaja: IsNull() },
        {
          empresaId: sucursal.empresa.id,
          sucursalId: IsNull(),
          fechaBaja: IsNull(),
        },
      ],
    });
    return (
      vigentes.find((c) => c.sucursalId === sucursalId) ??
      vigentes.find((c) => c.sucursalId === null) ??
      null
    );
  }

  /** Sucursales activas que no resuelven ninguna cuenta (ni propia ni de la empresa). */
  async sucursalesSinCuenta(
    empresaId: number,
  ): Promise<{ id: number; nombre: string | null }[]> {
    const { empresa, sucursales } = await this.listar(empresaId);
    if (empresa.configurada) {
      return [];
    }
    return sucursales
      .filter((s) => s.activa && !s.cuentaPropia)
      .map((s) => ({ id: s.sucursalId, nombre: s.nombre }));
  }

  /** Credenciales en claro de una cuenta, vigente o dada de baja (para verificar sus pagos). */
  credenciales(cuenta: CuentaFlow): CredencialesFlow {
    return {
      apiKey: cuenta.apiKey,
      secretKey: this.cifrado.descifrar(cuenta.secretKeyCifrada),
    };
  }

  async buscarPorId(id: number): Promise<CuentaFlow | null> {
    return this.cuentaRepo.findOne({ where: { id } });
  }

  private async guardar(
    empresaId: number,
    sucursalId: number | null,
    dto: GuardarCuentaFlowDto,
  ): Promise<ResumenCuentaFlow> {
    // Antes de tocar la BD: sin FLOW_CREDENCIALES_KEY responde 503.
    const secretKeyCifrada = this.cifrado.cifrar(dto.secretKey);

    await this.dataSource.transaction(async (manager) => {
      await this.darDeBaja(manager, empresaId, sucursalId);
      await manager.save(
        manager.create(CuentaFlow, {
          empresaId,
          sucursalId,
          apiKey: dto.apiKey,
          secretKeyCifrada,
          fechaActualizacion: null,
          fechaBaja: null,
        }),
      );
    });

    return { configurada: true, apiKeyFinal: final(dto.apiKey) };
  }

  private async darDeBaja(
    manager: DataSource['manager'],
    empresaId: number,
    sucursalId: number | null,
  ): Promise<void> {
    const ahora = new Date();
    await manager.update(
      CuentaFlow,
      {
        empresaId,
        sucursalId: sucursalId ?? IsNull(),
        fechaBaja: IsNull(),
      },
      { fechaBaja: ahora, fechaActualizacion: ahora },
    );
  }

  private async validarSucursal(
    empresaId: number,
    sucursalId: number,
  ): Promise<void> {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa?.id !== empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para configurar los pagos de esta sucursal',
      );
    }
  }
}
