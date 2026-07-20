import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { CreateReservaDto } from './dto/create-reserva.dto';

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
  ) {}

  async getEmpresaBySlug(slug: string) {
    const empresaSlug = await this.empresaSlugRepo.findOne({
      where: { slug },
      relations: { empresa: true },
    });
    if (!empresaSlug) {
      throw new NotFoundException('Empresa no encontrada para este slug');
    }
    return empresaSlug.empresa;
  }

  async getSucursal(id: number) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id },
      relations: { empresa: true },
    });
    if (!sucursal) {
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
    return this.empleadoRepo.find({
      where: { sucursal: { id: sucursalId }, activo: true },
      order: { nombre: 'ASC' },
    });
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

  async createReserva(dto: CreateReservaDto) {
    let cliente: Cliente | null = null;

    if (dto.clienteEmail) {
      cliente = await this.clienteRepo.findOne({
        where: { email: dto.clienteEmail, empresa: { id: dto.empresaId } },
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
      where: { nombre: 'Programada' },
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

    return this.reservaRepo.save(reserva);
  }

  private generateCodigo(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'RES-';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
