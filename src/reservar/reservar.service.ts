import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  MoreThanOrEqual,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Cliente } from '../clientes/entities/cliente.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { Servicio } from '../servicios/entities/servicio.entity';
import { Empleado } from '../empleados/entities/empleado.entity';
import { Horario } from '../horarios/entities/horario.entity';
import { Bloqueo } from '../bloqueos/entities/bloqueo.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { EmpresaSlug } from '../empresas/entities/empresa-slug.entity';
import { Empresa } from '../empresas/entities/empresa.entity';
import { SuscripcionesService } from '../suscripciones/suscripciones.service';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { CreateReservaDto } from './dto/create-reserva.dto';

/** Estados de reserva que dejan la hora libre. */
const ESTADOS_QUE_LIBERAN = ['Cancelada', 'Rechazado', 'Anulado'];
/** Error de SQL Server cuando la transacción pierde un interbloqueo. */
const MSSQL_DEADLOCK = 1205;

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Margen de un día: el servidor y el cliente pueden estar en husos horarios distintos. */
function fechaMinima(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

@Injectable()
export class ReservarService {
  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(Servicio)
    private readonly servicioRepo: Repository<Servicio>,
    @InjectRepository(Empleado)
    private readonly empleadoRepo: Repository<Empleado>,
    @InjectRepository(Horario)
    private readonly horarioRepo: Repository<Horario>,
    @InjectRepository(Bloqueo)
    private readonly bloqueoRepo: Repository<Bloqueo>,
    @InjectRepository(ServicioEmpleado)
    private readonly servicioEmpleadoRepo: Repository<ServicioEmpleado>,
    @InjectRepository(EmpresaSlug)
    private readonly empresaSlugRepo: Repository<EmpresaSlug>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    private readonly dataSource: DataSource,
    private readonly suscripcionesService: SuscripcionesService,
    private readonly reservaCorreos: ReservaCorreosService,
  ) {}

  async getEmpresaBySlug(slug: string) {
    const empresa = await this.buscarEmpresaPorSlug(slug);

    // SPEC 01: la carga de la página pública también resuelve la suscripción,
    // así el excedente de una prueba vencida se oculta aunque el dueño no entre.
    await this.suscripcionesService.obtenerVigente(empresa.id);

    return {
      id: empresa.id,
      nombre: empresa.nombre,
      nombreComercial: empresa.nombreComercial,
      slug: empresa.slug,
      logo: empresa.logo,
    };
  }

  private async buscarEmpresaPorSlug(slug: string): Promise<Empresa> {
    // El slug principal vive en empresa.slug (se asigna al registrarse).
    const empresa = await this.empresaRepo.findOne({ where: { slug } });
    if (empresa) {
      return empresa;
    }

    // Respaldo: slugs alternativos/históricos en la tabla EmpresaSlug.
    const empresaSlug = await this.empresaSlugRepo.findOne({
      where: { slug },
      relations: { empresa: true },
    });
    if (!empresaSlug?.empresa) {
      throw new NotFoundException('Empresa no encontrada para este slug');
    }
    return empresaSlug.empresa;
  }

  async getSucursal(id: number) {
    const sucursal = await this.sucursalRepo.findOne({ where: { id } });
    // SPEC 01: una sucursal inactiva (p. ej. excedente del plan Gratis) no se publica.
    if (!sucursal || sucursal.activo === false) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    return {
      id: sucursal.id,
      nombre: sucursal.nombre,
      direccion: sucursal.direccion,
      comuna: sucursal.comuna,
      ciudad: sucursal.ciudad,
      region: sucursal.region,
      pais: sucursal.pais,
    };
  }

  async getServiciosByEmpresa(empresaId: number) {
    const servicios = await this.servicioRepo.find({
      where: { empresa: { id: empresaId }, activo: true },
      order: { nombre: 'ASC' },
    });
    return servicios.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      descripcion: s.descripcion,
      duracionMinutos: s.duracionMinutos,
      precio: s.precio,
      color: s.color,
    }));
  }

  async getEmpleadosBySucursal(sucursalId: number) {
    const empleados = await this.empleadoRepo
      .createQueryBuilder('empleado')
      .innerJoin('empleado.sucursal', 'sucursal')
      .where('sucursal.id = :sucursalId', { sucursalId })
      .andWhere('empleado.activo = :activo', { activo: true })
      .orderBy('empleado.nombre', 'ASC')
      .getMany();
    // Email y teléfono de los empleados no son públicos.
    return empleados.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      apellido: e.apellido,
      foto: e.foto,
      descripcion: e.descripcion,
    }));
  }

  async getHorariosBySucursal(sucursalId: number) {
    return this.horarioRepo.find({
      where: { sucursal: { id: sucursalId } },
      order: { diaSemana: 'ASC' },
    });
  }

  async getBloqueosBySucursal(sucursalId: number) {
    const bloqueos = await this.bloqueoRepo.find({
      where: { empleado: { sucursal: { id: sucursalId } } },
      relations: { empleado: true },
      order: { fecha: 'ASC' },
    });
    // El motivo del bloqueo es interno del negocio.
    return bloqueos.map((b) => ({
      id: b.id,
      empleadoId: b.empleado?.id,
      fecha: b.fecha,
      horaInicio: b.horaInicio,
      horaFin: b.horaFin,
    }));
  }

  async getServiciosEmpleadosBySucursal(sucursalId: number) {
    const relaciones = await this.servicioEmpleadoRepo.find({
      where: { empleado: { sucursal: { id: sucursalId } } },
      relations: { servicio: true, empleado: true },
    });
    return relaciones.map((se) => ({
      id: se.id,
      servicioId: se.servicio?.id,
      empleadoId: se.empleado?.id,
    }));
  }

  /** Lo único que la página pública necesita saber de las reservas: qué horas están tomadas. */
  async getOcupacionBySucursal(sucursalId: number) {
    const reservas = await this.reservaRepo.find({
      where: {
        sucursal: { id: sucursalId },
        fecha: MoreThanOrEqual(fechaMinima()),
        estado: { nombre: Not(In(ESTADOS_QUE_LIBERAN)) },
      },
      relations: { empleado: true, estado: true },
      order: { fecha: 'ASC', horaInicio: 'ASC' },
    });
    return reservas.map((r) => ({
      empleadoId: r.empleado?.id,
      fecha: r.fecha,
      horaInicio: r.horaInicio,
      horaFin: r.horaFin,
    }));
  }

  async createReserva(dto: CreateReservaDto) {
    if (dto.fecha < fechaMinima()) {
      throw new BadRequestException('La fecha de la reserva ya pasó');
    }

    const { servicio, horaInicio, horaFin } = await this.validarReferencias(dto);

    let saved: Reserva;
    try {
      // SERIALIZABLE: dos reservas simultáneas no pueden pasar ambas el control de solape.
      saved = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        if (dto.empleadoId) {
          await this.validarHoraLibre(manager, dto, horaInicio, horaFin);
        }
        const cliente = await this.obtenerCliente(manager, dto);
        const estado = await manager.findOne(Estado, {
          where: { tipo: 'Reserva', nombre: 'Programada' },
        });

        return manager.save(
          manager.create(Reserva, {
            codigo: uuidv4(),
            fecha: dto.fecha,
            horaInicio,
            horaFin,
            precio: servicio.precio,
            observacion: dto.observacion,
            empresa: { id: dto.empresaId },
            sucursal: { id: dto.sucursalId },
            cliente,
            servicio: { id: dto.servicioId },
            empleado: dto.empleadoId ? { id: dto.empleadoId } : undefined,
            estado: estado ?? undefined,
          }),
        );
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { number?: number })?.number === MSSQL_DEADLOCK
      ) {
        throw new ConflictException('La hora seleccionada ya no está disponible');
      }
      throw error;
    }

    // SPEC 02: correos en segundo plano; un fallo de envío no afecta la reserva.
    void this.reservaCorreos.notificarNuevaReserva(saved.id);

    // Sin la relación `cliente`: esta respuesta es pública.
    return {
      id: saved.id,
      codigo: saved.codigo,
      fecha: saved.fecha,
      horaInicio: saved.horaInicio,
      horaFin: saved.horaFin,
      precio: saved.precio,
    };
  }

  /** Comprueba que empresa, sucursal, servicio y empleado existan, estén activos y se correspondan. */
  private async validarReferencias(dto: CreateReservaDto) {
    const invalida = () =>
      new BadRequestException('Los datos de la reserva no son válidos');

    const sucursal = await this.sucursalRepo.findOne({
      where: { id: dto.sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal?.activo || sucursal.empresa?.id !== dto.empresaId) {
      throw invalida();
    }

    const servicio = await this.servicioRepo.findOne({
      where: { id: dto.servicioId },
      relations: { empresa: true },
    });
    if (!servicio?.activo || servicio.empresa?.id !== dto.empresaId) {
      throw invalida();
    }

    if (dto.empleadoId) {
      const empleado = await this.empleadoRepo.findOne({
        where: { id: dto.empleadoId },
        relations: { sucursal: true },
      });
      if (!empleado?.activo || empleado.sucursal?.id !== dto.sucursalId) {
        throw invalida();
      }
      const ofreceServicio = await this.servicioEmpleadoRepo.findOne({
        where: {
          empleado: { id: dto.empleadoId },
          servicio: { id: dto.servicioId },
        },
      });
      if (!ofreceServicio) {
        throw invalida();
      }
    }

    const inicio = aMinutos(dto.horaInicio);
    const fin = inicio + servicio.duracionMinutos;
    if (fin > 24 * 60) {
      throw invalida();
    }

    return { servicio, horaInicio: aHora(inicio), horaFin: aHora(fin) };
  }

  private async validarHoraLibre(
    manager: EntityManager,
    dto: CreateReservaDto,
    horaInicio: string,
    horaFin: string,
  ): Promise<void> {
    const solape = { inicio: horaInicio, fin: horaFin };

    const reservas = await manager
      .createQueryBuilder(Reserva, 'reserva')
      .leftJoin('reserva.estado', 'estado')
      .where('reserva.EmpleadoId = :empleadoId', { empleadoId: dto.empleadoId })
      .andWhere('reserva.fecha = :fecha', { fecha: dto.fecha })
      .andWhere('reserva.horaInicio < :fin AND reserva.horaFin > :inicio', solape)
      .andWhere('(estado.nombre IS NULL OR estado.nombre NOT IN (:...libres))', {
        libres: ESTADOS_QUE_LIBERAN,
      })
      .getCount();

    const bloqueos = await manager
      .createQueryBuilder(Bloqueo, 'bloqueo')
      .where('bloqueo.EmpleadoId = :empleadoId', { empleadoId: dto.empleadoId })
      .andWhere('bloqueo.fecha = :fecha', { fecha: dto.fecha })
      .andWhere('bloqueo.horaInicio < :fin AND bloqueo.horaFin > :inicio', solape)
      .getCount();

    if (reservas > 0 || bloqueos > 0) {
      throw new ConflictException('La hora seleccionada ya no está disponible');
    }
  }

  /** Los clientes son de cada empresa: el mismo email en otra empresa es otro cliente. */
  private async obtenerCliente(
    manager: EntityManager,
    dto: CreateReservaDto,
  ): Promise<Cliente> {
    if (dto.clienteEmail) {
      const existente = await manager.findOne(Cliente, {
        where: { email: dto.clienteEmail, empresa: { id: dto.empresaId } },
      });
      if (existente) {
        return existente;
      }
    }
    return manager.save(
      manager.create(Cliente, {
        nombre: dto.clienteNombre,
        email: dto.clienteEmail ?? '',
        telefono: dto.clienteTelefono,
        empresa: { id: dto.empresaId },
      }),
    );
  }
}
