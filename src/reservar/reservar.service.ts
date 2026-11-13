import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Reserva } from '../reservas/entities/reserva.entity';
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
import { ESTADOS_QUE_LIBERAN } from '../reservas/disponibilidad';
import { CreacionReservaService } from '../reservas/creacion-reserva.service';

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
    private readonly creacion: CreacionReservaService,
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
      await this.creacion.validarReferencias(dto);

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

    // SPEC 08: transacción SERIALIZABLE con control de solape, compartida con el panel.
    const { saved, pago } = await this.creacion.crearConHoraLibre(
      { empleadoId: dto.empleadoId, fecha: dto.fecha, horaInicio, horaFin },
      async (manager) => {
        const cliente = await this.creacion.obtenerCliente(manager, dto);
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
        const pendiente: Pago | null = cobro
          ? await this.abonos.registrarPendiente(manager, reserva.id, cobro)
          : null;
        return { saved: reserva, pago: pendiente };
      },
    );

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
}
