import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { User } from '../../auth/domain/user.entity';
import { ChatHistory } from '../../communication/domain/chat-history.entity';
import { MatchScore } from '../../lead-engine/domain/match-score.entity';
import { OperationType, PropertyType } from '../../properties/domain/property.enums';

export enum LeadStage {
  NUEVO = 'nuevo',
  CALIFICADO = 'calificado',
  VISITA_AGENDADA = 'visita_agendada',
  NEGOCIACION = 'negociacion',
  CERRADO = 'cerrado',
  PERDIDO = 'perdido',
}

export enum LeadTemperature {
  FRIO = 'frio',
  TIBIO = 'tibio',
  CALIENTE = 'caliente',
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', nullable: true }) fullName?: string;

  /** Número en formato E.164 (+549341...). Clave de conversación en WhatsApp. */
  @Index({ unique: true })
  @Column({ nullable: true }) phone?: string;

  @Column({ nullable: true }) email?: string;

  /** Asesor a cargo. Si se da de baja el usuario, el lead queda sin asignar. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedTo?: User | null;

  @Column({ type: 'enum', enum: LeadStage, default: LeadStage.NUEVO })
  stage: LeadStage;

  @Column({ type: 'enum', enum: LeadTemperature, default: LeadTemperature.FRIO })
  temperature: LeadTemperature;

  /** Puntaje 0-100 calculado por LeadEngineModule. */
  @Column({ name: 'lead_score', type: 'smallint', default: 0 })
  leadScore: number;

  // ---------- Perfil de búsqueda (siempre en USD) ----------
  @Column({ name: 'budget_min_usd', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  budgetMinUsd?: number;

  @Column({ name: 'budget_max_usd', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  budgetMaxUsd?: number;

  @Column({ name: 'wants_operation', type: 'enum', enum: OperationType, nullable: true })
  wantsOperation?: OperationType;

  @Column({ name: 'wanted_types', type: 'jsonb', default: () => "'[]'" })
  wantedTypes: PropertyType[];

  @Column({ name: 'preferred_neighborhoods', type: 'jsonb', default: () => "'[]'" })
  preferredNeighborhoods: string[];

  @Column({ name: 'min_rooms', type: 'smallint', nullable: true }) minRooms?: number;
  @Column({ name: 'needs_garage', type: 'boolean', default: false }) needsGarage: boolean;

  @Column({ name: 'has_mortgage_approval', type: 'boolean', nullable: true })
  hasMortgageApproval?: boolean; // crédito hipotecario preaprobado

  /** Urgencia declarada en el chat (0-1), extraída por el LLM. */
  @Column({ type: 'real', default: 0 }) urgency: number;

  /** Con true el asistente no responde: lo atiende un asesor. Se activa solo cuando un asesor escribe. */
  @Column({ name: 'ai_paused', type: 'boolean', default: false }) aiPaused: boolean;

  @Column({ name: 'last_interaction_at', type: 'timestamptz', nullable: true })
  lastInteractionAt?: Date;

  @OneToMany(() => ChatHistory, (c) => c.lead)
  chats: ChatHistory[];

  @OneToMany(() => MatchScore, (m) => m.lead)
  matches: MatchScore[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
