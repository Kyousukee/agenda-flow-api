import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reserva } from '../reservas/entities/reserva.entity';
import { ConfiguracionEmpresa } from '../configuracion-empresa/entities/configuracion-empresa.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { CorreosService } from './correos.service';
import {
  DatosReservaCorreo,
  MarcaEmpresa,
  PlantillaCorreo,
  colorValido,
} from './plantillas/layout';
import {
  formatearFecha,
  formatearFechaCorta,
  formatearHora,
  formatearPrecio,
} from './plantillas/formato';
import { reservaConfirmadaCliente } from './plantillas/reserva-confirmada-cliente';
import { reservaNuevaInterna } from './plantillas/reserva-nueva-interna';
import { estadoReservaCliente } from './plantillas/estado-reserva-cliente';
import { estadoReservaEmpleado } from './plantillas/estado-reserva-empleado';

interface ContextoReservaCorreo {
  marca: MarcaEmpresa;
  datos: DatosReservaCorreo;
  /** ConfiguracionEmpresa.EnviarCorreo (false si no hay fila). */
  enviarCorreoCliente: boolean;
  emailCliente: string | null;
  /** Empresa.Email o, si está vacío, el del primer Usuario activo. */
  emailEmpresa: string | null;
  emailEmpleado: string | null;
  nombreEmpleado: string | null;
}

/** Normaliza un email: recorta espacios y trata '' como ausente. */
function emailONull(valor: string | null | undefined): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

function mismoEmail(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function unirNoVacios(partes: Array<string | null | undefined>, sep: string) {
  const texto = partes
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(sep);
  return texto || null;
}

@Injectable()
export class ReservaCorreosService {
  private readonly logger = new Logger(ReservaCorreosService.name);

  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly correosService: CorreosService,
  ) {}

  /**
   * Reserva nueva: confirmación al cliente (si la empresa lo habilitó y hay email),
   * aviso a la empresa y aviso al empleado asignado. Nunca lanza.
   */
  async notificarNuevaReserva(reservaId: number): Promise<void> {
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx) return;

      const envios: Promise<boolean>[] = [];

      if (ctx.enviarCorreoCliente && ctx.emailCliente) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailCliente,
            reservaConfirmadaCliente(ctx.marca, ctx.datos),
            ctx.emailEmpresa,
          ),
        );
      }

      if (ctx.emailEmpresa) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailEmpresa,
            reservaNuevaInterna(ctx.marca, ctx.datos),
          ),
        );
      }

      // Si el empleado comparte email con la empresa, basta con un aviso interno.
      if (
        ctx.emailEmpleado &&
        !mismoEmail(ctx.emailEmpleado, ctx.emailEmpresa)
      ) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailEmpleado,
            reservaNuevaInterna(ctx.marca, ctx.datos, ctx.nombreEmpleado),
          ),
        );
      }

      await Promise.all(envios);
    } catch (err) {
      this.logger.error(
        `No se pudieron enviar los correos de la reserva ${reservaId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Cambio de estado: aviso al cliente (si la empresa lo habilitó y hay email)
   * y al empleado asignado. Nunca lanza.
   */
  async notificarCambioEstado(reservaId: number): Promise<void> {
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx) return;

      const envios: Promise<boolean>[] = [];

      if (ctx.enviarCorreoCliente && ctx.emailCliente) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailCliente,
            estadoReservaCliente(ctx.marca, ctx.datos),
            ctx.emailEmpresa,
          ),
        );
      }

      if (ctx.emailEmpleado) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailEmpleado,
            estadoReservaEmpleado(ctx.marca, ctx.datos, ctx.nombreEmpleado),
          ),
        );
      }

      await Promise.all(envios);
    } catch (err) {
      this.logger.error(
        `No se pudieron enviar los correos de cambio de estado de la reserva ${reservaId}: ${(err as Error).message}`,
      );
    }
  }

  private enviar(
    ctx: ContextoReservaCorreo,
    to: string,
    plantilla: PlantillaCorreo,
    replyTo?: string | null,
  ): Promise<boolean> {
    return this.correosService.enviar({
      to,
      subject: plantilla.subject,
      html: plantilla.html,
      text: plantilla.text,
      fromName: ctx.marca.nombre,
      replyTo: replyTo ?? undefined,
    });
  }

  private async cargarContexto(
    reservaId: number,
  ): Promise<ContextoReservaCorreo | null> {
    const reserva = await this.reservaRepo.findOne({
      where: { id: reservaId },
      relations: {
        cliente: true,
        empleado: true,
        servicio: true,
        sucursal: true,
        empresa: true,
        estado: true,
      },
    });
    if (!reserva) {
      this.logger.warn(
        `Reserva ${reservaId} no encontrada: no se envían correos.`,
      );
      return null;
    }
    if (!reserva.empresa) {
      this.logger.warn(
        `Reserva ${reservaId} sin empresa asociada: no se envían correos.`,
      );
      return null;
    }

    const empresa = reserva.empresa;
    const config = await this.configRepo.findOne({
      where: { empresa: { id: empresa.id } },
    });
    const emailEmpresa = await this.resolverEmailEmpresa(
      empresa.id,
      empresa.email,
    );

    const marca: MarcaEmpresa = {
      nombre: empresa.nombreComercial?.trim() || empresa.nombre,
      logoUrl: empresa.logo?.trim() || null,
      colorPrincipal: colorValido(empresa.colorPrincipal),
      telefono: empresa.telefono?.trim() || null,
      email: emailEmpresa,
    };

    const { cliente, empleado, servicio, sucursal, estado } = reserva;
    const nombreEmpleado = empleado
      ? unirNoVacios([empleado.nombre, empleado.apellido], ' ')
      : null;
    const mostrarPrecios = config?.mostrarPrecios ?? true;

    const datos: DatosReservaCorreo = {
      codigo: String(reserva.codigo).slice(0, 8).toUpperCase(),
      clienteNombre:
        unirNoVacios([cliente?.nombre, cliente?.apellido], ' ') ?? 'Cliente',
      clienteEmail: emailONull(cliente?.email),
      clienteTelefono: cliente?.telefono?.trim() || null,
      servicio: servicio?.nombre ?? 'Servicio',
      duracionMinutos: servicio?.duracionMinutos ?? 0,
      empleado: nombreEmpleado,
      sucursal: sucursal?.nombre?.trim() || 'Sucursal',
      direccion: unirNoVacios(
        [sucursal?.direccion, sucursal?.comuna, sucursal?.ciudad],
        ', ',
      ),
      fecha: formatearFecha(reserva.fecha),
      fechaCorta: formatearFechaCorta(reserva.fecha),
      hora: `${formatearHora(reserva.horaInicio)} – ${formatearHora(reserva.horaFin)}`,
      horaInicio: formatearHora(reserva.horaInicio),
      precio:
        mostrarPrecios &&
        reserva.precio !== null &&
        reserva.precio !== undefined
          ? formatearPrecio(reserva.precio)
          : null,
      observacion: reserva.observacion?.trim() || null,
      estado: {
        nombre: estado?.nombre ?? 'Sin estado',
        color: estado?.color ?? null,
      },
    };

    return {
      marca,
      datos,
      enviarCorreoCliente: config?.enviarCorreo ?? false,
      emailCliente: datos.clienteEmail,
      emailEmpresa,
      emailEmpleado: emailONull(empleado?.email),
      nombreEmpleado,
    };
  }

  /** Empresa.Email o, si está vacío, el del primer Usuario activo de la empresa. */
  private async resolverEmailEmpresa(
    empresaId: number,
    emailEmpresa: string | null | undefined,
  ): Promise<string | null> {
    const propio = emailONull(emailEmpresa);
    if (propio) return propio;

    const usuario = await this.usuarioRepo.findOne({
      where: { empresa: { id: empresaId }, activo: true },
      order: { id: 'ASC' },
    });
    return emailONull(usuario?.email);
  }
}
