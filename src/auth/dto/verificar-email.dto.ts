import { IsString, MaxLength } from 'class-validator';

export class VerificarEmailDto {
  @IsString()
  @MaxLength(128)
  token: string;
}
