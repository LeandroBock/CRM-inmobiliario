import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Lead } from '../../leads/domain/lead.entity';

export enum ChatRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  /** Asesor humano que respondió desde el CRM. */
  AGENT = 'agent',
  SYSTEM = 'system',
}

export enum ChatChannel {
  WHATSAPP = 'whatsapp',
  WEB = 'web',
}

@Entity('chat_history')
@Index(['lead', 'createdAt'])
export class ChatHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Lead, (l) => l.chats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  @Column({ type: 'enum', enum: ChatChannel, default: ChatChannel.WHATSAPP })
  channel: ChatChannel;

  @Column({ type: 'enum', enum: ChatRole })
  role: ChatRole;

  @Column({ type: 'text' }) content: string;

  /** Adjunto del cliente: 'audio' (content = transcripción) o 'image' (content = epígrafe). */
  @Column({ name: 'media_type', type: 'varchar', nullable: true }) mediaType?: 'audio' | 'image' | null;
  /** Archivo en ChatMediaStorage (privado). */
  @Column({ name: 'media_file', type: 'varchar', nullable: true }) mediaFile?: string | null;
  @Column({ name: 'media_mime', type: 'varchar', nullable: true }) mediaMime?: string | null;

  /** Nombre del asesor, solo en mensajes con role = agent. */
  @Column({ name: 'author_name', nullable: true }) authorName?: string;

  /** ID del mensaje en WhatsApp (wamid). Único para deduplicar reintentos del webhook. */
  @Index({ unique: true, where: '"external_message_id" IS NOT NULL' })
  @Column({ name: 'external_message_id', nullable: true })
  externalMessageId?: string;

  /** Datos que el LLM extrajo del mensaje (presupuesto, barrio, urgencia, cita...). */
  @Column({ type: 'jsonb', nullable: true }) extractedData?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
