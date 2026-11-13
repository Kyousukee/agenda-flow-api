import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { UpdateReservaEstadoDto } from './dto/update-reserva-estado.dto';
import { AbonosService } from '../pagos/abonos.service';
import { Servicio } from '../servicios/entities/servicio.entity';
import { Horario } from '../horarios/entities/horario.entity';
import { Bloqueo } from '../bloqueos/entities/bloqueo.entity';
import { ServicioEmpleado } from '../servicios-empleados/entities/servicio-empleado.entity';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { validarAlcanceSucursal } from '../auth/alcance-sucursal';
import { ProximaHoraQueryDto } from './dto/proxima-hora-query.dto';
import { ESTADOS_QUE_LIBERAN } from './disponibilidad';
import {
  CreacionReservaService,
  diaDeLaSemana,
} from './creacion-reserva.service';
import { CreateReservaPanelDto } from './dto/create-reserva-panel.dto';
import { ahoraEnNegocio, horaDeMinutos, minutosDeHora } from './hora-negocio';
import {
  primerHueco,
  redondearAbajo,
  redondearArriba,
  type Tramo,
} from './huecos';
import { v4 as uuidv4 } from 'uuid';

/** SPEC 08: una fila de GET /reservas/proxima-hora. */
export interface ProximaHoraEmpleado {
  empleadoId: number;
  nombre: string | null;
  apellido: string | null;
  foto: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  reservasAntes: number;
  esperaMinutos: number | null;
}

/** Reserva activa del día pasada a minutos, para el hueco y la cola. */
export interface ReservaDelDia extends Tramo {
  completada: boolean;
}

/**
 * SPEC 08: reservas que el cliente tiene "antes que él": activas, no completadas, que
 * terminan después de `desde` y empiezan antes del hueco. Incluye la que está en curso.
 * Sin hueco, cuenta todas las que quedan en el día.
 */
export function contarReservasAntes(
  reservas: ReservaDelDia[],
  desde: number,
  hueco: number | null,
): number {
  const limite = hueco ?? Number.POSITIVE_INFINITY;
  return reservas.filter(
    (r) => !r.completada && r.fin > desde && r.inicio < limite,
  ).length;
}

function aReservaDelDia(r: Reserva): ReservaDelDia {
  return {
    inicio: minutosDeHora(r.horaInicio),
    fin: minutosDeHora(r.horaFin),
    completada: r.estado?.nombre === 'Completada',
  };
}

@Injectable()
export class ReservasService {
  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    private readonly reservaCorreos: ReservaCorreosService,
    private readonly abonos: AbonosService,
    @InjectRepository(Servicio)
    private readonly servicioRepo: Repository<Servicio>,
    @InjectRepository(Horario)
    private readonly horarioRepo: Repository<Horario>,
    @InjectRepository(Bloqueo)
    private readonly bloqueoRepo: Repository<Bloqueo>,
    @InjectRepository(ServicioEmpleado)
    private readonly servicioEmpleadoRepo: Repository<ServicioEmpleado>,
    private readonly creacion: CreacionReservaService,
  ) {}

  /**
   * SPEC 08: reserva presencial o telefónica desde el panel. Nace Programada, sin abono,
   * con Origen 'Panel' y el usuario que la agendó. No recalcula la hora.
   */
  async crearDesdePanel(
    user: JwtPayload,
    dto: CreateReservaPanelDto,
    ahora: Date = new Date(),
  ) {
    const sucursalAlcance = await this.sucursalRepo.findOne({
      where: { id: dto.sucursalId },
      relations: { empresa: true },
    });
    if (!sucursalAlcance) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    validarAlcanceSucursal(user, sucursalAlcance);

    const datos = { ...dto, empresaId: user.empresaId };
    const { servicio, empleado, horaInicio, horaFin } =
      await this.creacion.validarReferencias(datos);

    const hoy = ahoraEnNegocio(ahora);
    const yaPaso =
      dto.fecha < hoy.fecha ||
      (dto.fecha === hoy.fecha &&
        minutosDeHora(horaInicio) < redondearAbajo(hoy.minutos));
    if (yaPaso) {
      throw new BadRequestException('La hora seleccionada ya pasó');
    }

    // SPEC 06: antes del control de solape, para que una retención vencida no bloquee la hora.
    await this.abonos.anularVencidos(dto.sucursalId);

    const saved = await this.creacion.crearConHoraLibre(
      { empleadoId: dto.empleadoId, fecha: dto.fecha, horaInicio, horaFin },
      async (manager) => {
        const cliente = await this.creacion.obtenerCliente(manager, datos);
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
            empresa: { id: user.empresaId },
            sucursal: { id: dto.sucursalId },
            cliente,
            servicio: { id: dto.servicioId },
            empleado: { id: dto.empleadoId },
            estado: estado ?? undefined,
            origen: 'Panel',
            usuarioCreador: { id: user.sub },
          }),
        );
      },
    );

    const desde = dto.fecha === hoy.fecha ? redondearArriba(hoy.minutos) : 0;
    const otras = (
      await this.reservasActivasDelDia([dto.empleadoId], dto.fecha)
    ).filter((r) => r.id !== saved.id);
    const reservasAntes = contarReservasAntes(
      otras.map(aReservaDelDia),
      desde,
      minutosDeHora(horaInicio),
    );

    // SPEC 02: en segundo plano. SPEC 08: sin aviso interno al local.
    void this.reservaCorreos.notificarNuevaReserva(saved.id, {
      avisoInterno: false,
    });

    return {
      id: saved.id,
      codigo: saved.codigo,
      fecha: dto.fecha,
      horaInicio,
      horaFin,
      precio: servicio.precio,
      estado: 'Programada' as const,
      origen: 'Panel' as const,
      empleado: {
        id: dto.empleadoId,
        nombre: empleado?.nombre ?? null,
        apellido: empleado?.apellido ?? null,
      },
      cliente: { nombre: dto.clienteNombre },
      reservasAntes,
    };
  }

  /**
   * Reservas que ocupan la agenda de esos empleados ese día. Misma regla que
   * horaOcupada: una reserva sin estado también ocupa.
   */
  private reservasActivasDelDia(ids: number[], fecha: string) {
    return this.reservaRepo
      .createQueryBuilder('reserva')
      .leftJoinAndSelect('reserva.estado', 'estado')
      .leftJoinAndSelect('reserva.empleado', 'empleado')
      .where('reserva.EmpleadoId IN (:...ids)', { ids })
      .andWhere('reserva.fecha = :fecha', { fecha })
      .andWhere(
        '(estado.nombre IS NULL OR estado.nombre NOT IN (:...libres))',
        { libres: ESTADOS_QUE_LIBERAN },
      )
      .getMany();
  }

  /**
   * SPEC 08: para un servicio, cada empleado activo de la sucursal que lo ofrece con su
   * primer hueco del día, cuántas reservas tiene antes y los minutos de espera.
   */
  async proximaHora(
    user: JwtPayload,
    query: ProximaHoraQueryDto,
    ahora: Date = new Date(),
  ) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: query.sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    validarAlcanceSucursal(user, sucursal);

    const hoy = ahoraEnNegocio(ahora);
    const fecha = query.fecha ?? hoy.fecha;
    if (fecha < hoy.fecha) {
      throw new BadRequestException('La fecha ya pasó');
    }
    const esHoy = fecha === hoy.fecha;

    const servicio = await this.servicioRepo.findOne({
      where: { id: query.servicioId },
      relations: { empresa: true },
    });
    if (!servicio?.activo || servicio.empresa?.id !== user.empresaId) {
      throw new BadRequestException('El servicio no es válido');
    }

    // SPEC 06: una retención de pago vencida no debe ocupar el hueco.
    await this.abonos.anularVencidos(sucursal.id);

    const relaciones = await this.servicioEmpleadoRepo.find({
      where: {
        servicio: { id: servicio.id },
        empleado: { sucursal: { id: sucursal.id }, activo: true },
      },
      relations: { empleado: true },
    });
    const empleados = relaciones
      .map((r) => r.empleado)
      .filter((e, i, todos) => todos.findIndex((o) => o.id === e.id) === i);

    const base = {
      fecha,
      ahora: horaDeMinutos(hoy.minutos),
      servicio: {
        id: servicio.id,
        nombre: servicio.nombre,
        duracionMinutos: servicio.duracionMinutos,
      },
    };
    if (empleados.length === 0) {
      return { ...base, empleados: [] as ProximaHoraEmpleado[] };
    }
    const ids = empleados.map((e) => e.id);

    const [horarios, reservas, bloqueos] = await Promise.all([
      this.horarioRepo.find({
        where: {
          sucursal: { id: sucursal.id },
          diaSemana: diaDeLaSemana(fecha),
          abierto: true,
        },
      }),
      this.reservasActivasDelDia(ids, fecha),
      this.bloqueoRepo.find({
        where: { empleado: { id: In(ids) }, fecha },
        relations: { empleado: true },
      }),
    ]);

    const abiertos: Tramo[] = horarios.map((h) => ({
      inicio: minutosDeHora(h.horaInicio),
      fin: minutosDeHora(h.horaFin),
    }));
    const desde = esHoy ? redondearArriba(hoy.minutos) : 0;

    const filas: ProximaHoraEmpleado[] = empleados.map((empleado) => {
      const suyas: ReservaDelDia[] = reservas
        .filter((r) => r.empleado?.id === empleado.id)
        .map(aReservaDelDia);
      const ocupados: Tramo[] = [
        ...suyas,
        ...bloqueos
          .filter((b) => b.empleado?.id === empleado.id)
          .map((b) => ({
            inicio: minutosDeHora(b.horaInicio),
            fin: minutosDeHora(b.horaFin),
          })),
      ];
      const hueco = primerHueco({
        desde,
        duracion: servicio.duracionMinutos,
        abiertos,
        ocupados,
      });
      return {
        empleadoId: empleado.id,
        nombre: empleado.nombre ?? null,
        apellido: empleado.apellido ?? null,
        foto: empleado.foto ?? null,
        horaInicio: hueco === null ? null : horaDeMinutos(hueco),
        horaFin:
          hueco === null
            ? null
            : horaDeMinutos(hueco + servicio.duracionMinutos),
        reservasAntes: contarReservasAntes(suyas, desde, hueco),
        esperaMinutos:
          hueco === null || !esHoy ? null : Math.max(0, hueco - hoy.minutos),
      };
    });

    // Los sin cupo al final; "HH:mm" ordena igual que la hora.
    filas.sort((a, b) => {
      if (a.horaInicio === b.horaInicio) return 0;
      if (a.horaInicio === null) return 1;
      if (b.horaInicio === null) return -1;
      return a.horaInicio < b.horaInicio ? -1 : 1;
    });

    return { ...base, empleados: filas };
  }

  async findAllBySucursal(sucursalId: number, user: JwtPayload) {
    const sucursal = await this.sucursalRepo.findOne({
      where: { id: sucursalId },
      relations: { empresa: true },
    });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    if (sucursal.empresa.id !== user.empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para ver las reservas de esta sucursal',
      );
    }
    // SPEC 08: el recepcionista solo ve su sucursal.
    validarAlcanceSucursal(user, sucursal);

    // SPEC 06: el panel no muestra como "Esperando pago" una retención ya vencida.
    await this.abonos.anularVencidos(sucursalId);

    const reservas = await this.reservaRepo.find({
      where: { sucursal: { id: sucursalId } },
      relations: {
        cliente: true,
        empleado: true,
        servicio: true,
        estado: true,
        sucursal: true,
        pagos: true,
        usuarioCreador: true,
      },
      order: { fecha: 'DESC', horaInicio: 'ASC' },
    });
    // SPEC 08: del usuario que agendó solo se expone id y nombre (la entidad trae PasswordHash).
    return reservas.map((r) => ({
      ...r,
      usuarioCreador: r.usuarioCreador
        ? { id: r.usuarioCreador.id, nombre: r.usuarioCreador.nombre }
        : null,
    }));
  }

  async actualizarEstado(
    id: number,
    dto: UpdateReservaEstadoDto,
    user: JwtPayload,
  ) {
    const reserva = await this.reservaRepo.findOne({
      where: { id },
      relations: { estado: true, sucursal: { empresa: true } },
    });
    if (!reserva) {
      throw new NotFoundException('Reserva no encontrada');
    }
    if (reserva.sucursal?.empresa?.id !== user.empresaId) {
      throw new ForbiddenException(
        'No tienes permiso para modificar esta reserva',
      );
    }
    // SPEC 08: el recepcionista solo modifica reservas de su sucursal.
    validarAlcanceSucursal(user, reserva.sucursal);

    const estado = await this.estadoRepo.findOne({
      where: { id: dto.estadoId },
    });
    if (!estado) {
      throw new NotFoundException('Estado no encontrado');
    }
    if (estado.tipo !== 'Reserva') {
      throw new BadRequestException('El estado no es válido para una reserva');
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
}
