import { IsString, MaxLength, MinLength } from 'class-validator';

export class RestablecerContrasenaDto {
  @IsString()
  @MaxLength(128)
  token: string;

  // bcrypt ignora lo que pase de 72 bytes.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
