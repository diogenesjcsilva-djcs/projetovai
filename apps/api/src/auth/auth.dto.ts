import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phone!: string;

  @IsIn(['passenger', 'driver'])
  role!: 'passenger' | 'driver';
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9][0-9]{7,14}$/)
  phone!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;

  @IsIn(['passenger', 'driver'])
  role!: 'passenger' | 'driver';
}

export class RefreshSessionDto {
  @IsString()
  @MinLength(40)
  @MaxLength(200)
  refreshToken!: string;
}

export class LogoutDto extends RefreshSessionDto {}
