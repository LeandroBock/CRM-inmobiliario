import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { User } from '../domain/user.entity';
import { UserRole } from '../domain/user-role.enum';
import { BCRYPT_ROUNDS, UsersService } from './users.service';

export interface SessionResponse {
  accessToken: string;
  user: { id: string; email: string; fullName: string; role: UserRole };
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /** Hash falso para comparar siempre contra algo: así el tiempo de respuesta no revela si el email existe. */
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await hash('contraseña-inexistente-para-igualar-tiempos', BCRYPT_ROUNDS);
    await this.ensureFirstAdmin();
  }

  /** Si la base no tiene usuarios, crea el primer administrador con ADMIN_EMAIL / ADMIN_PASSWORD. */
  private async ensureFirstAdmin() {
    if ((await this.users.count()) > 0) return;

    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('No hay usuarios y faltan ADMIN_EMAIL / ADMIN_PASSWORD en el .env: nadie va a poder iniciar sesión.');
      return;
    }
    if (password.length < 10) {
      this.logger.warn('ADMIN_PASSWORD debe tener al menos 10 caracteres: no se creó el administrador.');
      return;
    }
    await this.users.create({ email, password, fullName: 'Administrador', role: UserRole.ADMIN });
    this.logger.log(`Administrador inicial creado: ${email}`);
  }

  async login(email: string, password: string): Promise<SessionResponse> {
    const user = await this.users.findByEmailWithHash(email);
    const passwordOk = await compare(password, user?.passwordHash ?? this.dummyHash);

    // Mismo mensaje para email inexistente, contraseña errónea o usuario desactivado.
    if (!user || !passwordOk || !user.isActive) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }
    await this.users.touchLogin(user.id);
    return this.buildSession(user);
  }

  /** Cambia la contraseña y devuelve una sesión nueva (los tokens anteriores quedan invalidados). */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<SessionResponse> {
    const user = await this.users.findByIdWithHash(userId);
    if (!user || !user.isActive || !(await compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    await this.users.setPassword(userId, newPassword);
    return this.buildSession(await this.users.findOne(userId));
  }

  private async buildSession(user: User): Promise<SessionResponse> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { accessToken, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } };
  }
}
