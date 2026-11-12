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
import { AbonosService } from '../pagos/abonos.service';
import type { CobroAbono, PagoIniciado } from '../pagos/abonos.service';
import { calcularAbono } from '../pagos/abonos';
import { Pago } from '../pagos/entities/pago.entity';
import { ESTADOS_QUE_LIBERAN, horaOcupada } from '../reservas/disponibilidad';

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

/** Día de la semana de una fecha AAAA-MM-DD: 1 = lunes … 7 = domingo. */
function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7;
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
    private readonly abonos: AbonosService,
  ) {}

  async getEmpresaBySlug(slug: string) {
    const empresa = await this.buscarEmpresaPorSlug(slug);

    // SPEC 01: la carga de la página pública también resuelve la suscripción,
    // así el excedente de una prueba vencida se oculta aunque el dueño no entre.
    const suscripcion = await this.suscripcionesService.obtenerVigente(
      empresa.id,
    );
    // SPEC 06: configuración de cobro al reservar.
    const { publico } = await this.abonos.resolverPagoOnline(
      empresa.id,
      suscripcion,
    );

    return {
      id: empresa.id,
      nombre: empresa.nombre,
      nombreComercial: empresa.nombreComercial,
      slug: empresa.slug,
      logo: empresa.logo,
      pagoOnline: publico,
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
    const [servicios, { config }] = await Promise.all([
      this.servicioRepo.find({
        where: { empresa: { id: empresaId }, activo: true },
        order: { nombre: 'ASC' },
      }),
      this.abonos.resolverPagoOnline(empresaId),
    ]);
    return servicios.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      descripcion: s.descripcion,
      duracionMinutos: s.duracionMinutos,
      precio: s.precio,
      color: s.color,
      // SPEC 06: lo que se cobra al reservar; null si no se cobra.
      abono: config ? calcularAbono(s.precio, config) : null,
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

  /** SPEC 06: resultado del pago online de una reserva, para la página de retorno del front. */
  getEstadoPago(codigo: string) {
    return this.abonos.estadoPagoDeReserva(codigo);
  }

  /** Lo único que la página pública necesita saber de las reservas: qué horas están tomadas. */
  async getOcupacionBySucursal(sucursalId: number) {
    // SPEC 06: libera las horas retenidas por pagos que no se confirmaron a tiempo.
    await this.abonos.anularVencidos(sucursalId);
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

    const { servicio, sucursal, horaInicio, horaFin } =
      await this.validarReferencias(dto);

    // SPEC 06: antes del control de solape, para que una retención vencida no bloquee la hora.
    await this.abonos.anularVencidos(dto.sucursalId);

    // SPEC 06: si se cobra el abono, la reserva nace Pendiente y retiene la hora.
    const cobro = await this.abonos.evaluarCobro({
      empresaId: dto.empresaId,
      sucursalId: dto.sucursalId,
      precio: servicio.precio,
      pagarAhora: dto.pagarAhora,
    });
    if (cobro && !dto.clienteEmail) {
      throw new BadRequestException(
        'El email es obligatorio para pagar online',
      );
    }

    let saved: Reserva;
    let pago: Pago | null;
    try {
      // SERIALIZABLE: dos reservas simultáneas no pueden pasar ambas el control de solape.
      ({ saved, pago } = await this.dataSource.transaction(
        'SERIALIZABLE',
        async (manager) => {
          if (dto.empleadoId) {
            await this.validarHoraLibre(manager, dto, horaInicio, horaFin);
          }
          const cliente = await this.obtenerCliente(manager, dto);
          const estado = await manager.findOne(Estado, {
            where: {
              tipo: 'Reserva',
              nombre: cobro ? 'Pendiente' : 'Programada',
            },
          });

          const reserva = await manager.save(
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
          const pendiente = cobro
            ? await this.abonos.registrarPendiente(manager, reserva.id, cobro)
            : null;
          return { saved: reserva, pago: pendiente };
        },
      ));
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { number?: number })?.number === MSSQL_DEADLOCK
      ) {
        throw new ConflictException(
          'La hora seleccionada ya no está disponible',
        );
      }
      throw error;
    }

    const pagoIniciado = await this.iniciarPago(
      pago,
      saved.id,
      cobro,
      dto,
      `${sucursal.empresa.nombreComercial || sucursal.empresa.nombre} - ${servicio.nombre}`,
    );

    // SPEC 02: correos en segundo plano; un fallo de envío no afecta la reserva.
    // SPEC 06: con pago en curso, los correos salen al confirmarse el pago.
    if (!pagoIniciado) {
      void this.reservaCorreos.notificarNuevaReserva(saved.id);
    }

    // Sin la relación `cliente`: esta respuesta es pública.
    return {
      id: saved.id,
      codigo: saved.codigo,
      fecha: saved.fecha,
      horaInicio: saved.horaInicio,
      horaFin: saved.horaFin,
      precio: saved.precio,
      estado: pagoIniciado ? 'Pendiente' : 'Programada',
      pago: pagoIniciado,
    };
  }

  /** SPEC 06: crea el cobro en Flow. null si no hay cobro o si Flow falló (fallback sin pago). */
  private async iniciarPago(
    pago: Pago | null,
    reservaId: number,
    cobro: CobroAbono | null,
    dto: CreateReservaDto,
    subject: string,
  ): Promise<PagoIniciado | null> {
    if (!pago || !cobro || !dto.clienteEmail) {
      return null;
    }
    return this.abonos.iniciar({
      pago,
      reservaId,
      cobro,
      email: dto.clienteEmail,
      subject: subject.slice(0, 200),
    });
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

    await this.validarHorarioDeAtencion(dto, inicio, fin);

    return {
      servicio,
      sucursal,
      horaInicio: aHora(inicio),
      horaFin: aHora(fin),
    };
  }

  /** La reserva completa debe caber en un horario abierto de la sucursal para ese día. */
  private async validarHorarioDeAtencion(
    dto: CreateReservaDto,
    inicio: number,
    fin: number,
  ): Promise<void> {
    const horarios = await this.horarioRepo.find({
      where: {
        sucursal: { id: dto.sucursalId },
        diaSemana: diaDeLaSemana(dto.fecha),
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

  private async validarHoraLibre(
    manager: EntityManager,
    dto: CreateReservaDto,
    horaInicio: string,
    horaFin: string,
  ): Promise<void> {
    const ocupada = await horaOcupada(manager, {
      empleadoId: dto.empleadoId!,
      fecha: dto.fecha,
      horaInicio,
      horaFin,
    });
    if (ocupada) {
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
