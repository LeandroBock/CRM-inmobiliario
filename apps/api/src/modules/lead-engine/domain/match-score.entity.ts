import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Lead } from '../../leads/domain/lead.entity';
import { Property } from '../../properties/domain/property.entity';

export enum MatchFeedback {
  PENDIENTE = 'pendiente',
  ME_GUSTA = 'me_gusta',
  NO_ME_INTERESA = 'no_me_interesa',
  VISITO = 'visito',
}

@Entity('match_scores')
@Unique(['lead', 'property'])
@Index(['lead', 'score'])
export class MatchScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Lead, (l) => l.matches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  @ManyToOne(() => Property, (p) => p.matches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  /** Puntaje final 0-100. */
  @Column({ type: 'real' }) score: number;

  /** Desglose por criterio (presupuesto, zona, tipología, etc.) para explicabilidad. */
  @Column({ type: 'jsonb' }) breakdown: Record<string, number>;

  @Column({ type: 'enum', enum: MatchFeedback, default: MatchFeedback.PENDIENTE })
  feedback: MatchFeedback;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
