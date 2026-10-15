import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { RentalContract } from './rental-contract.entity';

/** Un pago (total o parcial) de un mes de alquiler. Un mes puede tener varios pagos parciales. */
@Entity('rental_payments')
@Index(['contract', 'period'])
export class RentalPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RentalContract, (c) => c.payments, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: RentalContract;

  /** Mes que se paga: primer día del mes (YYYY-MM-01). */
  @Column({ type: 'date' }) period: string;
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) amount: number;
  @Column({ name: 'paid_at', type: 'date' }) paidAt: string;
  /** Efectivo, transferencia, etc. */
  @Column({ type: 'varchar', nullable: true }) method?: string | null;
  @Column({ type: 'text', nullable: true }) notes?: string | null;
  @Column({ name: 'author_name', type: 'varchar', nullable: true }) authorName?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
