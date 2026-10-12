import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** La cuenta de TikTok de la inmobiliaria (una sola). Los tokens se guardan cifrados (TOKEN_ENCRYPTION_KEY). */
@Entity('tiktok_accounts')
export class TikTokAccount {
  /** Siempre 'principal': hay una sola cuenta conectada. */
  @PrimaryColumn({ type: 'varchar' }) id: string;

  @Column({ name: 'open_id', type: 'varchar' }) openId: string;
  @Column({ name: 'display_name', type: 'varchar', nullable: true }) displayName?: string | null;
  @Column({ name: 'username', type: 'varchar', nullable: true }) username?: string | null;
  @Column({ type: 'varchar', nullable: true }) scope?: string | null;

  @Column({ name: 'access_token_enc', type: 'text', select: false }) accessTokenEnc: string;
  @Column({ name: 'access_expires_at', type: 'timestamptz' }) accessExpiresAt: Date;
  @Column({ name: 'refresh_token_enc', type: 'text', select: false }) refreshTokenEnc: string;
  @Column({ name: 'refresh_expires_at', type: 'timestamptz' }) refreshExpiresAt: Date;

  /** Quién la conectó (id de usuario del CRM). */
  @Column({ name: 'connected_by', type: 'uuid', nullable: true }) connectedBy?: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
