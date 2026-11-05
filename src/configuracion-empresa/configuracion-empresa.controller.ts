import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Delete,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfiguracionEmpresaService } from './configuracion-empresa.service';
import { CreateConfiguracionDto } from './dto/create-configuracion.dto';
import { UpdateConfiguracionDto } from './dto/update-configuracion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

@Controller('configuracion-empresa')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(1)
export class ConfiguracionEmpresaController {
  constructor(private readonly configService: ConfiguracionEmpresaService) {}

  @Get()
  find(@Req() req: { user?: JwtPayload }) {
    return this.configService.findByEmpresa(req.user!.empresaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateConfiguracionDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.configService.create(dto, req.user!.empresaId);
  }

  @Put()
  update(
    @Body() dto: UpdateConfiguracionDto,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.configService.update(dto, req.user!.empresaId);
  }

  // multipart/form-data con el campo "logo". Sin SVG (puede contener scripts).
  @Post('logo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: LOGO_MAX_BYTES } }),
  )
  uploadLogo(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: LOGO_MAX_BYTES,
            message: 'El logo no puede superar 2 MB',
          }),
          new FileTypeValidator({ fileType: /^image\/(png|jpe?g|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Req() req: { user?: JwtPayload },
  ) {
    return this.configService.uploadLogo(file, req.user!.empresaId);
  }

  @Delete('logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLogo(@Req() req: { user?: JwtPayload }) {
    return this.configService.deleteLogo(req.user!.empresaId);
  }
}
