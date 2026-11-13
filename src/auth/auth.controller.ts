import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CuentaService } from './cuenta.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarEmailDto } from './dto/verificar-email.dto';
import { OlvideContrasenaDto } from './dto/olvide-contrasena.dto';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto';
import { AceptarInvitacionDto } from './dto/aceptar-invitacion.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { GoogleRegistroDto } from './dto/google-registro.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cuentaService: CuentaService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /** SPEC 05: inicia sesión con Google o responde `requiereRegistro`. */
  @Post('google')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async loginGoogle(@Body() dto: GoogleLoginDto) {
    return this.authService.loginGoogle(dto.credential);
  }

  /** SPEC 05: crea la cuenta con Google y los datos del negocio. */
  @Post('google/registro')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  async registroGoogle(@Body() dto: GoogleRegistroDto) {
    return this.authService.registroGoogle(dto);
  }

  @Post('verificar-email')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verificarEmail(@Body() dto: VerificarEmailDto) {
    return this.cuentaService.verificarEmail(dto.token);
  }

  @Post('reenviar-verificacion')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async reenviarVerificacion(@Req() req: { user?: JwtPayload }) {
    return this.cuentaService.reenviarVerificacion(req.user!.sub);
  }

  @Post('olvide-contrasena')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  olvideContrasena(@Body() dto: OlvideContrasenaDto) {
    this.cuentaService.olvideContrasena(dto.email);
    return {
      message:
        'Si el email está registrado, te enviaremos un enlace para restablecer tu contraseña.',
    };
  }

  @Post('restablecer-contrasena')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async restablecerContrasena(@Body() dto: RestablecerContrasenaDto) {
    await this.cuentaService.restablecerContrasena(dto.token, dto.password);
    return { message: 'Tu contraseña fue restablecida. Inicia sesión.' };
  }

  /** SPEC 08: datos de la invitación para la página pública. No expone nada más. */
  @Get('invitacion/:token')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  consultarInvitacion(@Param('token') token: string) {
    return this.cuentaService.consultarInvitacion(token);
  }

  /** SPEC 08: el recepcionista crea su contraseña y entra directo (misma respuesta que login). */
  @Post('aceptar-invitacion')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async aceptarInvitacion(@Body() dto: AceptarInvitacionDto) {
    const usuarioId = await this.cuentaService.aceptarInvitacion(
      dto.token,
      dto.password,
    );
    return this.authService.sesionDe(usuarioId);
  }
}
