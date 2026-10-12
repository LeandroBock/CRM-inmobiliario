import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser } from '../domain/auth.types';
import { UserRole } from '../domain/user-role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Ruta accesible sin token (login, webhooks con su propia verificación). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe la ruta (o el controller) a ciertos roles. Sin este decorador basta con estar autenticado. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el usuario autenticado: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
