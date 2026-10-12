import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthUser, JwtPayload } from '../domain/auth.types';
import { IS_PUBLIC_KEY } from '../presentation/decorators';
import { UsersService } from './users.service';

/** Guard global: toda ruta exige un token válido salvo las marcadas con @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Falta el token de acceso');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    // El usuario se relee en cada request: desactivarlo o cambiarle el rol rige de inmediato.
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException('Sesión inválida o vencida');

    // Tokens emitidos antes del último cambio de contraseña ya no valen (comparación en segundos, como iat).
    if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
