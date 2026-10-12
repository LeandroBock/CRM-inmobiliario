import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from './user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Siempre en minúsculas. */
  @Index({ unique: true })
  @Column()
  email: string;

  /** select:false => nunca viaja en consultas normales; solo se pide explícito para validar el login. */
  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role', default: UserRole.AGENT })
  role: UserRole;

  /** Recibe por email los avisos de sus leads (cliente esperando, visita por confirmar...). */
  @Column({ name: 'email_alerts', default: true })
  emailAlerts: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Los tokens emitidos antes de esta fecha dejan de valer (cambio de contraseña). */
  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt?: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
