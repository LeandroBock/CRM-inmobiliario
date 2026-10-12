import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UsersService } from '../application/users.service';
import { AuthUser } from '../domain/auth.types';
import { UserRole } from '../domain/user-role.enum';
import { CreateUserDto, UpdateUserDto } from './auth.dto';
import { CurrentUser, Roles } from './decorators';

/** Gestión de usuarios: solo administradores. */
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  /** Asesores activos (id y nombre) para asignar leads. Lo puede ver cualquier usuario logueado. */
  @Get('team')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  team() {
    return this.users.team();
  }

  @Get()
  list() {
    return this.users.list();
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(id, dto, actor.id);
  }
}
