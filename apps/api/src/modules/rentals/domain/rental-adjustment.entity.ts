import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { RentalContract } from './rental-contract.entity';
import { AdjustmentIndex } from './rental.enums';

/** Un ajuste aplicado: queda el historial con los valores del índice que se usaron. */
@Entity('rental_adjustments')
export class RentalAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => RentalContract, (c) => c.adjustments, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'contract_id' })
  contract: RentalContract;

  /** Desde cuándo rige el nuevo monto. */
  @Column({ name: 'effective_date', type: 'date' }) effectiveDate: string;
  @Column({ name: 'previous_rent', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) previousRent: number;
  @Column({ name: 'new_rent', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) newRent: number;
  @Column({ type: 'numeric', precision: 12, scale: 6, transformer: numericTransformer }) factor: number;
  @Column({ type: 'enum', enum: AdjustmentIndex }) index: AdjustmentIndex;
  /** Cómo se calculó: valores y fechas del índice, o "monto editado a mano". */
  @Column({ type: 'jsonb', nullable: true }) detail?: Record<string, unknown> | null;
  @Column({ name: 'author_name', type: 'varchar', nullable: true }) authorName?: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
