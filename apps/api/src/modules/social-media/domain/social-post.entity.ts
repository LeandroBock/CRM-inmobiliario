import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Property } from '../../properties/domain/property.entity';

export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  LINKEDIN = 'linkedin',
  TIKTOK = 'tiktok',
}

export enum PostStatus {
  BORRADOR = 'borrador',
  PROGRAMADO = 'programado',
  /** Se está subiendo a la red (evita publicar dos veces si se aprieta dos veces o coincide con el programador). */
  PUBLICANDO = 'publicando',
  PUBLICADO = 'publicado',
  FALLIDO = 'fallido',
}

export enum PostFormat {
  IMAGEN = 'imagen',
  CARRUSEL = 'carrusel',
  REEL = 'reel',
  VIDEO = 'video',
  TEXTO = 'texto',
}

@Entity('social_posts')
@Index(['platform', 'status', 'scheduledAt'])
export class SocialPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Property, (p) => p.socialPosts, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'property_id' })
  property?: Property;

  @Column({ type: 'enum', enum: SocialPlatform })
  platform: SocialPlatform;

  @Column({ type: 'enum', enum: PostFormat, default: PostFormat.IMAGEN })
  format: PostFormat;

  @Column({ type: 'text' }) copy: string;
  @Column({ type: 'text', nullable: true }) script?: string; // guion para reels/TikTok
  @Column({ type: 'jsonb', default: () => "'[]'" }) hashtags: string[];
  @Column({ name: 'media_urls', type: 'jsonb', default: () => "'[]'" }) mediaUrls: string[];

  @Column({ type: 'enum', enum: PostStatus, default: PostStatus.BORRADOR })
  status: PostStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true }) scheduledAt?: Date | null;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true }) publishedAt?: Date;

  /** ID del post en la plataforma (para consultar métricas). */
  @Column({ name: 'external_id', nullable: true }) externalId?: string;
  /** Link al posteo publicado (para abrirlo desde el CRM). */
  @Column({ name: 'external_url', type: 'varchar', nullable: true }) externalUrl?: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage?: string | null;

  // ---------- Métricas (se refrescan con un job periódico) ----------
  @Column({ type: 'int', default: 0 }) views: number;
  @Column({ type: 'int', default: 0 }) likes: number;
  @Column({ type: 'int', default: 0 }) comments: number;
  @Column({ type: 'int', default: 0 }) shares: number;
  @Column({ type: 'int', default: 0 }) clicks: number;

  /** (likes+comments+shares+clicks)/views, calculado al refrescar métricas. */
  @Column({ name: 'engagement_rate', type: 'real', default: 0 }) engagementRate: number;

  @Column({ name: 'metrics_updated_at', type: 'timestamptz', nullable: true }) metricsUpdatedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
