import { UserRole } from './user-role.enum';

/** Usuario autenticado adjunto al request por JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
