import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Cliente } from '../clientes/entities/cliente.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Horario } from '../horarios/entities/horario.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { horaOcupada } from './disponibilidad';

/** Error de SQL Server cuando la transacción pierde un interbloqueo. */
const MSSQL_DEADLOCK = 1205;

const MENSAJE_HORA_OCUPADA = 'La hora seleccionada ya no está disponible';

export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Día de la semana de una fecha AAAA-MM-DD: 1 = lunes … 7 = domingo. */
export function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7;
}

/** Lo que comparten la reserva pública y la del panel. */
export interface DatosReserva {
  empresaId: number;
  sucursalId: number;
  servicioId: number;
  empleadoId?: number;
  fecha: string;
  horaInicio: string;
}

export interface DatosCliente {
  empresaId: number;
  clienteNombre: string;
  clienteEmail?: string;
  clienteTelefono?: string;
}

export interface TramoReserva {
  empleadoId?: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

/**
 * SPEC 08: validaciones y transacción de creación que usan `POST /reservar` (público)
 * y `POST /reservas` (panel). Se extrajo de ReservarService sin cambiar su comportamiento.
 */
@Injectable()
export class CreacionReservaService {
  constructor(
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Servicio)
    private readonly servicioRepo: Repository<Servicio>,
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    @InjectRepository(Horario)
    private readonly horarioRepo: Repository<Horario>,
    @InjectRepository(ServicioEmpleado)
    private readonly servicioEmpleadoRepo: Repository<ServicioEmpleado>,
    private readonly dataSource: DataSource,
  ) {}

  /** Comprueba que empresa, sucursal, servicio y empleado existan, estén activos y se correspondan. */
  async validarReferencias(datos: DatosReserva) {
    const invalida = () =>
      new BadRequestException('Los datos de la reserva no son válidos');

    const sucursal = await this.sucursalRepo.findOne({
      where: { id: datos.sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal?.activo || sucursal.empresa?.id !== datos.empresaId) {
      throw invalida();
    }

    const servicio = await this.servicioRepo.findOne({
      where: { id: datos.servicioId },
      relations: { empresa: true },
    });
    if (!servicio?.activo || servicio.empresa?.id !== datos.empresaId) {
      throw invalida();
    }

    let empleado: Empleado | null = null;
    if (datos.empleadoId) {
      empleado = await this.empleadoRepo.findOne({
        where: { id: datos.empleadoId },
        relations: { sucursal: true },
      });
      if (!empleado?.activo || empleado.sucursal?.id !== datos.sucursalId) {
        throw invalida();
      }
      const ofreceServicio = await this.servicioEmpleadoRepo.findOne({
        where: {
          empleado: { id: datos.empleadoId },
          servicio: { id: datos.servicioId },
        },
      });
      if (!ofreceServicio) {
        throw invalida();
      }
    }

    const inicio = aMinutos(datos.horaInicio);
    const fin = inicio + servicio.duracionMinutos;
    if (fin > 24 * 60) {
      throw invalida();
    }

    await this.validarHorarioDeAtencion(datos, inicio, fin);

    return {
      servicio,
      sucursal,
      empleado,
      horaInicio: aHora(inicio),
      horaFin: aHora(fin),
    };
  }

  /** La reserva completa debe caber en un horario abierto de la sucursal para ese día. */
  private async validarHorarioDeAtencion(
    datos: DatosReserva,
    inicio: number,
    fin: number,
  ): Promise<void> {
    const horarios = await this.horarioRepo.find({
      where: {
        sucursal: { id: datos.sucursalId },
        diaSemana: diaDeLaSemana(datos.fecha),
        abierto: true,
      },
    });
    const dentroDelHorario = horarios.some(
      (h) => aMinutos(h.horaInicio) <= inicio && fin <= aMinutos(h.horaFin),
    );
    if (!dentroDelHorario) {
      throw new BadRequestException(
        'La hora seleccionada está fuera del horario de atención',
      );
    }
  }

  /**
   * Ejecuta `crear` en una transacción SERIALIZABLE después de comprobar que el empleado
   * tiene libre el tramo: dos reservas simultáneas no pueden pasar ambas el control.
   * Un interbloqueo de SQL Server se informa como 409.
   */
  async crearConHoraLibre<T>(
    tramo: TramoReserva,
    crear: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager) => {
          if (tramo.empleadoId) {
            const ocupada = await horaOcupada(manager, {
              empleadoId: tramo.empleadoId,
              fecha: tramo.fecha,
              horaInicio: tramo.horaInicio,
              horaFin: tramo.horaFin,
            });
            if (ocupada) {
              throw new ConflictException(MENSAJE_HORA_OCUPADA);
            }
          }
          return crear(manager);
        },
      );
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { number?: number })?.number === MSSQL_DEADLOCK
      ) {
        throw new ConflictException(MENSAJE_HORA_OCUPADA);
      }
      throw error;
    }
  }

  /** Los clientes son de cada empresa: el mismo email en otra empresa es otro cliente. */
  async obtenerCliente(
    manager: EntityManager,
    datos: DatosCliente,
  ): Promise<Cliente> {
    if (datos.clienteEmail) {
      const existente = await manager.findOne(Cliente, {
        where: { email: datos.clienteEmail, empresa: { id: datos.empresaId } },
      });
      if (existente) {
        return existente;
      }
    }
    return manager.save(
      manager.create(Cliente, {
        nombre: datos.clienteNombre,
        email: datos.clienteEmail ?? '',
        telefono: datos.clienteTelefono,
        empresa: { id: datos.empresaId },
      }),
    );
  }
}
