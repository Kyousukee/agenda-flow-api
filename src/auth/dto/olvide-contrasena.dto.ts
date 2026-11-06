import { IsEmail, MaxLength } from 'class-validator';

export class OlvideContrasenaDto {
  @IsEmail()
  @MaxLength(150)
  email: string;
}
