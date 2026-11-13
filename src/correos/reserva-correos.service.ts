import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  formatearInstante,
  formatearPrecio,
} from './plantillas/formato';
import { reservaConfirmadaCliente } from './plantillas/reserva-confirmada-cliente';
import type { CancelacionOnline } from './plantillas/reserva-confirmada-cliente';
import { generarToken } from '../auth/token-cuenta';
import { limiteCancelacion } from '../reservas/cancelacion';
import { leerFrontUrl } from '../flow/token-flow';

/** Valor por defecto de ConfiguracionEmpresa.TiempoCancelacionHoras. */
const TIEMPO_CANCELACION_POR_DEFECTO = 24;
import { reservaNuevaInterna } from './plantillas/reserva-nueva-interna';
import { estadoReservaCliente } from './plantillas/estado-reserva-cliente';
import { estadoReservaEmpleado } from './plantillas/estado-reserva-empleado';
import { cancelacionCliente } from './plantillas/cancelacion-cliente';
import { reembolsoRechazadoInterno } from './plantillas/reembolso-rechazado-interno';

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
  /** SPEC 07: datos sin formatear para calcular el plazo de cancelación. */
  reservaId: number;
  fechaReserva: string | Date;
  horaInicioReserva: string | Date;
  /** ConfiguracionEmpresa.TiempoCancelacionHoras (24 si no hay fila). */
  tiempoCancelacionHoras: number;
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
  private readonly frontUrl: string;

  constructor(
    @InjectRepository(Reserva)
    private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(ConfiguracionEmpresa)
    private readonly configRepo: Repository<ConfiguracionEmpresa>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly correosService: CorreosService,
    config: ConfigService,
  ) {
    // Sale del entorno y nunca de la petición (como en CuentaCorreosService).
    this.frontUrl = leerFrontUrl(config);
  }

  /**
   * Reserva nueva: confirmación al cliente (si la empresa lo habilitó y hay email),
   * aviso a la empresa y aviso al empleado asignado. Nunca lanza.
   * SPEC 08: con `avisoInterno: false` (reserva creada desde el panel) solo se envía
   * la confirmación al cliente: quien la agendó ya está en el local.
   */
  async notificarNuevaReserva(
    reservaId: number,
    opciones: { avisoInterno?: boolean } = {},
  ): Promise<void> {
    const avisoInterno = opciones.avisoInterno ?? true;
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx) return;

      const envios: Promise<boolean>[] = [];

      if (ctx.enviarCorreoCliente && ctx.emailCliente) {
        const cancelacion = await this.enlaceCancelacion(ctx);
        envios.push(
          this.enviar(
            ctx,
            ctx.emailCliente,
            reservaConfirmadaCliente(ctx.marca, ctx.datos, cancelacion),
            ctx.emailEmpresa,
          ),
        );
      }

      if (avisoInterno && ctx.emailEmpresa) {
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
        avisoInterno &&
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

  /**
   * SPEC 07: el cliente canceló desde el enlace. Confirmación al cliente (con el reembolso,
   * si hay) y aviso al local y al empleado asignado con la plantilla de cambio de estado.
   * Nunca lanza.
   */
  async notificarCancelacionCliente(
    reservaId: number,
    montoReembolso: number | null,
  ): Promise<void> {
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx) return;

      const envios: Promise<boolean>[] = [];
      if (ctx.enviarCorreoCliente && ctx.emailCliente) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailCliente,
            cancelacionCliente(ctx.marca, ctx.datos, {
              cancelada: true,
              reembolso:
                montoReembolso === null
                  ? null
                  : formatearPrecio(montoReembolso),
            }),
            ctx.emailEmpresa,
          ),
        );
      }
      if (ctx.emailEmpresa) {
        envios.push(
          this.enviar(
            ctx,
            ctx.emailEmpresa,
            estadoReservaEmpleado(ctx.marca, ctx.datos),
          ),
        );
      }
      if (
        ctx.emailEmpleado &&
        !mismoEmail(ctx.emailEmpleado, ctx.emailEmpresa)
      ) {
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
        `No se pudieron enviar los correos de cancelación de la reserva ${reservaId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * SPEC 07: el local reembolsó desde el panel (y quizá canceló la reserva). Solo al
   * cliente, si la empresa le envía correos. Nunca lanza.
   */
  async notificarReembolso(
    reservaId: number,
    monto: number,
    cancelada: boolean,
  ): Promise<void> {
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx || !ctx.enviarCorreoCliente || !ctx.emailCliente) return;

      await this.enviar(
        ctx,
        ctx.emailCliente,
        cancelacionCliente(ctx.marca, ctx.datos, {
          cancelada,
          reembolso: formatearPrecio(monto),
        }),
        ctx.emailEmpresa,
      );
    } catch (err) {
      this.logger.error(
        `No se pudo enviar el correo de reembolso de la reserva ${reservaId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * SPEC 07: Flow rechazó un reembolso después de aceptarlo. Aviso al local para que
   * reintente desde el panel. Nunca lanza.
   */
  async notificarReembolsoRechazado(
    reservaId: number,
    monto: number,
    error: string | null,
  ): Promise<void> {
    try {
      const ctx = await this.cargarContexto(reservaId);
      if (!ctx) return;
      if (!ctx.emailEmpresa) {
        this.logger.warn(
          `Reserva ${reservaId}: la empresa no tiene email para avisar el reembolso rechazado`,
        );
        return;
      }
      await this.enviar(
        ctx,
        ctx.emailEmpresa,
        reembolsoRechazadoInterno(ctx.marca, ctx.datos, {
          monto: formatearPrecio(monto),
          error,
          urlPanel: `${this.frontUrl}/admin/pagos`,
        }),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo avisar el reembolso rechazado de la reserva ${reservaId}: ${(err as Error).message}`,
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
      reservaId: reserva.id,
      fechaReserva: reserva.fecha,
      horaInicioReserva: reserva.horaInicio,
      tiempoCancelacionHoras:
        config?.tiempoCancelacionHoras ?? TIEMPO_CANCELACION_POR_DEFECTO,
    };
  }

  /**
   * SPEC 07: genera el token del enlace público de cancelación y guarda solo su hash.
   * Un token nuevo reemplaza al anterior (pago tardío de SPEC 06). Si el plazo ya pasó,
   * o no se pudo guardar el hash, el correo sale sin el botón. El token nunca va al log.
   */
  private async enlaceCancelacion(
    ctx: ContextoReservaCorreo,
  ): Promise<CancelacionOnline | null> {
    try {
      const limite = limiteCancelacion(
        ctx.fechaReserva,
        ctx.horaInicioReserva,
        ctx.tiempoCancelacionHoras,
      );
      if (Date.now() >= limite.getTime()) {
        return null;
      }
      const { token, hash } = generarToken();
      await this.reservaRepo.update(ctx.reservaId, {
        tokenCancelacionHash: hash,
      });
      return {
        url: `${this.frontUrl}/reserva/cancelar?token=${token}`,
        limite: formatearInstante(limite),
      };
    } catch (err) {
      this.logger.error(
        `No se pudo generar el enlace de cancelación de la reserva ${ctx.reservaId}: ${(err as Error).message}`,
      );
      return null;
    }
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
