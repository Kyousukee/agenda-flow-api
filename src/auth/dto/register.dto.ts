import {
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  MinLength,
  Min,
  MaxLength,
  IsLatitude,
  IsLongitude,
  validate,
} from 'class-validator';
import { Type, plainToInstance } from 'class-transformer';

export class RegisterDto {
  // === PASO 1: Cuenta de usuario ===
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsEmail()
  @MaxLength(150)
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // === PASO 2: Datos del negocio ===
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  empresaNombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombreComercial?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  empresaEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  // === PASO 3: Primera sucursal ===
  @IsOptional()
  @IsString()
  @MaxLength(150)
  sucursalNombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  comuna?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ciudad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pais?: string;

  @IsOptional()
  @IsNumber()
  latitud?: number | null;

  @IsOptional()
  @IsNumber()
  longitud?: number | null;
}
