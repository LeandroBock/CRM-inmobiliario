import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../application/auth.service';
import { UsersService } from '../application/users.service';
import { AuthUser } from '../domain/auth.types';
import { ChangePasswordDto, LoginDto, PreferencesDto } from './auth.dto';
import { CurrentUser, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly users: UsersService) {}

  /** 5 intentos por minuto y por IP para frenar fuerza bruta. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const { id, email, fullName, role, emailAlerts } = await this.users.findOne(user.id);
    return { id, email, fullName, role, emailAlerts };
  }

  /** Preferencias propias (cualquier usuario sobre sí mismo). */
  @Patch('me/preferences')
  async preferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    await this.users.setPreferences(user.id, dto);
    return this.me(user);
  }

  /** Devuelve una sesión nueva; el token anterior deja de valer. */
  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
