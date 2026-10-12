import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Lead } from '../../leads/domain/lead.entity';
import { Property } from '../../properties/domain/property.entity';
import { VisitSource, VisitStatus } from './visit.enums';

export * from './visit.enums';

@Entity('visits')
@Index(['startAt'])
@Index(['property', 'startAt'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Lead, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  @ManyToOne(() => Property, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @Column({ name: 'start_at', type: 'timestamptz' }) startAt: Date;
  @Column({ name: 'duration_min', type: 'smallint', default: 45 }) durationMin: number;

  @Column({ type: 'enum', enum: VisitStatus, default: VisitStatus.PENDIENTE })
  status: VisitStatus;

  @Column({ type: 'enum', enum: VisitSource, default: VisitSource.ASESOR })
  source: VisitSource;

  @Column({ type: 'text', nullable: true }) notes?: string;

  /** Evento en Google Calendar y de quién es ese calendario (para moverlo si el lead cambia de asesor). */
  @Column({ name: 'google_event_id', type: 'varchar', nullable: true }) googleEventId?: string | null;
  @Column({ name: 'google_calendar_owner_id', type: 'uuid', nullable: true }) googleCalendarOwnerId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
