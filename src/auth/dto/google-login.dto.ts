import { IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleLoginDto {
  /** ID token que entrega Google Identity Services al front. */
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  credential: string;
}
