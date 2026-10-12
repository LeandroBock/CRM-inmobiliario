import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../domain/user-role.enum';

/** Los teclados de celular suelen agregar un espacio al final del email autocompletado. */
const TrimLower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

// bcrypt solo considera los primeros 72 bytes de la contraseña, por eso el tope.
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 72;

export class LoginDto {
  @TrimLower() @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX) password: string;
}

export class CreateUserDto {
  @TrimLower() @IsEmail() email: string;
  @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) password: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) fullName?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Reseteo de contraseña por un administrador. */
  @IsOptional() @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) password?: string;
}

export class PreferencesDto {
  @IsOptional() @IsBoolean() emailAlerts?: boolean;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(PASSWORD_MAX) currentPassword: string;
  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) newPassword: string;
}
