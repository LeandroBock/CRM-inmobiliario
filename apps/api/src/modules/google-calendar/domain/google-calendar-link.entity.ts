import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../auth/domain/user.entity';

/** Cuenta de Google conectada por un usuario del CRM (una por usuario). */
@Entity('google_calendar_links')
export class GoogleCalendarLink {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Cuenta de Google conectada (para mostrarle al usuario dónde aparecen las visitas). */
  @Column({ name: 'google_email' }) googleEmail: string;

  /** Refresh token cifrado con SecretBox. Nunca se devuelve en una respuesta. */
  @Column({ name: 'refresh_token_enc', type: 'text', select: false }) refreshTokenEnc: string;

  @Column({ name: 'calendar_id', default: 'primary' }) calendarId: string;

  @CreateDateColumn({ name: 'connected_at', type: 'timestamptz' }) connectedAt: Date;
}
