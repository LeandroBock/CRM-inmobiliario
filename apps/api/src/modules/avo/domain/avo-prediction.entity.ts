import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { Property } from '../../properties/domain/property.entity';

/**
 * Resultado de una tasación. TODOS los valores monetarios son USD:
 * el modelo se entrena y predice en dólares para evitar distorsión inflacionaria.
 */
@Entity('avo_predictions')
export class AvoPrediction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Property, (p) => p.predictions, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'property_id' })
  property?: Property; // null si fue una tasación de una propiedad aún no cargada

  @Column({ name: 'estimated_price_usd', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  estimatedPriceUsd: number;

  @Column({ name: 'price_per_m2_usd', type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  pricePerM2Usd: number;

  @Column({ name: 'range_low_usd', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  rangeLowUsd: number;

  @Column({ name: 'range_high_usd', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  rangeHighUsd: number;

  /** Valor estimado a 3 años y plusvalía porcentual. */
  @Column({ name: 'projected_price_3y_usd', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  projectedPrice3yUsd: number;

  @Column({ name: 'appreciation_3y_pct', type: 'numeric', precision: 6, scale: 2, transformer: numericTransformer })
  appreciation3yPct: number;

  @Column({ type: 'real', nullable: true }) confidence?: number; // 0-1

  @Column({ name: 'model_version' }) modelVersion: string;

  /** Variables enviadas al modelo (auditoría y reentrenamiento). */
  @Column({ name: 'input_features', type: 'jsonb' })
  inputFeatures: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
