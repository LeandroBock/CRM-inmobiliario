import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum NotificationType {
  /** El asistente pidió una visita: hay que confirmarla. */
  VISITA_POR_CONFIRMAR = 'visita_por_confirmar',
  /** Escribió un cliente con el asistente pausado, o el asistente pidió que lo atienda una persona. */
  CLIENTE_ESPERANDO = 'cliente_esperando',
  /** El puntaje del lead lo pasó a "caliente". */
  LEAD_CALIENTE = 'lead_caliente',
  /** Le asignaron un lead (a mano o automáticamente al entrar por WhatsApp). */
  LEAD_ASIGNADO = 'lead_asignado',
  /** Alquileres: un contrato tiene un ajuste listo para aplicar (o falta un índice para calcularlo). */
  ALQUILER_AJUSTE = 'alquiler_ajuste',
  /** Alquileres: un contrato vence en menos de 60 días. */
  ALQUILER_VENCE = 'alquiler_vence',
  /** Alquileres: hay meses vencidos sin pagar. */
  ALQUILER_DEUDA = 'alquiler_deuda',
}

/**
 * Cada aviso es para el asesor a cargo del lead (userId). Sin asesor (userId null) lo ve todo el equipo.
 */
@Entity('notifications')
@Index(['readAt', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationType }) type: NotificationType;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) body?: string;

  /** Sin FK a propósito: el aviso puede sobrevivir al lead (y al borrarlo se limpian en LeadsService). */
  @Index()
  @Column({ name: 'lead_id', type: 'uuid', nullable: true }) leadId?: string;

  /** Contrato de alquiler (avisos de alquileres). Sin FK, igual que lead_id. */
  @Index()
  @Column({ name: 'contract_id', type: 'uuid', nullable: true }) contractId?: string | null;

  /** Destinatario. Sin FK: si se borra el usuario el aviso queda huérfano, y no molesta. */
  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId?: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true }) readAt?: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
