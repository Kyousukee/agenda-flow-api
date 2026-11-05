import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { UpdateReservaEstadoDto } from './dto/update-reserva-estado.dto';

@Injectable()
export class ReservarService {
  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
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
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    @InjectRepository(EmpresaSlug)
    private readonly empresaSlugRepo: Repository<EmpresaSlug>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    private readonly suscripcionesService: SuscripcionesService,
    private readonly reservaCorreos: ReservaCorreosService,
  ) {}

  async getEmpresaBySlug(slug: string) {
    const empresa = await this.buscarEmpresaPorSlug(slug);

    // SPEC 01: la carga de la página pública también resuelve la suscripción,
    // así el excedente de una prueba vencida se oculta aunque el dueño no entre.
    await this.suscripcionesService.obtenerVigente(empresa.id);

    return empresa;
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
    const sucursal = await this.sucursalRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    // SPEC 01: una sucursal inactiva (p. ej. excedente del plan Gratis) no se publica.
    if (!sucursal || sucursal.activo === false) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    return sucursal;
  }

  async getServiciosByEmpresa(empresaId: number) {
    return this.servicioRepo.find({
      where: { empresa: { id: empresaId }, activo: true },
      order: { nombre: 'ASC' },
    });
  }

  async getEmpleadosBySucursal(sucursalId: number) {
    return this.empleadoRepo
      .createQueryBuilder('empleado')
      .innerJoin('empleado.sucursal', 'sucursal')
      .where('sucursal.id = :sucursalId', { sucursalId })
      .andWhere('empleado.activo = :activo', { activo: true })
      .orderBy('empleado.nombre', 'ASC')
      .getMany();
  }

  async getHorariosBySucursal(sucursalId: number) {
    return this.horarioRepo.find({
      where: { sucursal: { id: sucursalId } },
      order: { diaSemana: 'ASC' },
    });
  }

  async getBloqueosBySucursal(sucursalId: number) {
    return this.bloqueoRepo.find({
      where: { empleado: { sucursal: { id: sucursalId } } },
      relations: { empleado: true },
      order: { fecha: 'ASC' },
    });
  }

  async getServiciosEmpleadosBySucursal(sucursalId: number) {
    return this.servicioEmpleadoRepo.find({
      where: { empleado: { sucursal: { id: sucursalId } } },
      relations: { servicio: true, empleado: true },
    });
  }

  async getReservasBySucursal(sucursalId: number) {
    return this.reservaRepo.find({
      where: { sucursal: { id: sucursalId } },
      relations: { cliente: true, empleado: true, servicio: true, estado: true, sucursal: true, pagos: true },
      order: { fecha: 'DESC', horaInicio: 'ASC' },
    });
  }

  async createReserva(dto: CreateReservaDto) {
    let cliente: Cliente | null = null;

    if (dto.clienteEmail) {
      cliente = await this.clienteRepo.findOne({
        where: { email: dto.clienteEmail },
      });
    }

    if (!cliente) {
      cliente = this.clienteRepo.create({
        nombre: dto.clienteNombre,
        email: dto.clienteEmail ?? '',
        telefono: dto.clienteTelefono,
        empresa: { id: dto.empresaId },
      });
      cliente = await this.clienteRepo.save(cliente);
    }

    const estadoProgramada = await this.estadoRepo.findOne({
      where: { tipo: 'Reserva', nombre: 'Programada' },
    });

    const codigo = this.generateCodigo();

    const reserva = this.reservaRepo.create({
      codigo,
      fecha: dto.fecha,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      precio: dto.precio,
      observacion: dto.observacion,
      empresa: { id: dto.empresaId },
      sucursal: { id: dto.sucursalId } as any,
      cliente,
      servicio: { id: dto.servicioId } as any,
      empleado: dto.empleadoId
        ? ({ id: dto.empleadoId } as any)
        : undefined,
      estado: estadoProgramada ?? undefined,
    });

    const saved = await this.reservaRepo.save(reserva);

    // SPEC 02: correos en segundo plano; un fallo de envío no afecta la reserva.
    void this.reservaCorreos.notificarNuevaReserva(saved.id);

    return saved;
  }

  async actualizarEstadoReserva(id: number, dto: UpdateReservaEstadoDto) {
    const reserva = await this.reservaRepo.findOne({
      where: { id },
      relations: { estado: true },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }

    const estado = await this.estadoRepo.findOne({ where: { id: dto.estadoId } });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }

    // SPEC 02: si el estado no cambia, no se guarda ni se notifica.
    if (reserva.estado?.id === estado.id) {
      return reserva;
    }

    reserva.estado = estado;
    const saved = await this.reservaRepo.save(reserva);

    // SPEC 02: correos en segundo plano; un fallo de envío no afecta el cambio.
    void this.reservaCorreos.notificarCambioEstado(saved.id);

    return saved;
  }

  private generateCodigo(): string {
    return uuidv4();
  }
}
