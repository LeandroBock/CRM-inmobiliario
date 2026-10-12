import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../domain/user.entity';
import { UserRole } from '../domain/user-role.enum';
import { CreateUserDto, UpdateUserDto } from '../presentation/auth.dto';

// En los tests (NODE_ENV=test) basta con el mínimo: cada usuario de prueba tardaría ~250 ms en crearse.
export const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  count(): Promise<number> {
    return this.repo.count();
  }

  async create(dto: CreateUserDto): Promise<User> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repo.exist({ where: { email } })) {
      throw new ConflictException('Ya existe un usuario con ese email');
    }
    const saved = await this.repo.save(
      this.repo.create({
        email,
        fullName: dto.fullName.trim(),
        role: dto.role ?? UserRole.AGENT,
        passwordHash: await hash(dto.password, BCRYPT_ROUNDS),
      }),
    );
    return this.findOne(saved.id); // relee sin el hash
  }

  list(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  team(): Promise<Pick<User, 'id' | 'fullName' | 'role'>[]> {
    return this.repo.find({ select: { id: true, fullName: true, role: true }, where: { isActive: true }, order: { fullName: 'ASC' } });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  findActiveById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id, isActive: true } });
  }

  /** Única consulta que trae el hash: solo para validar contraseñas. */
  findByEmailWithHash(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findByIdWithHash(id: string): Promise<User | null> {
    return this.repo.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id }).getOne();
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<User> {
    const user = await this.findOne(id);

    // Evita que un admin se deje afuera a sí mismo (siempre queda al menos un admin activo: el que opera).
    if (id === actorId && (dto.isActive === false || (dto.role && dto.role !== UserRole.ADMIN))) {
      throw new BadRequestException('No podés desactivarte ni sacarte el rol de administrador a vos mismo');
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.password !== undefined) {
      user.passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
      user.passwordChangedAt = new Date();
    }
    await this.repo.save(user);
    return this.findOne(id);
  }

  async setPreferences(id: string, prefs: { emailAlerts?: boolean }): Promise<void> {
    if (prefs.emailAlerts !== undefined) await this.repo.update(id, { emailAlerts: prefs.emailAlerts });
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    await this.repo.update(id, {
      passwordHash: await hash(newPassword, BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
    });
  }

  async touchLogin(id: string): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }
}
