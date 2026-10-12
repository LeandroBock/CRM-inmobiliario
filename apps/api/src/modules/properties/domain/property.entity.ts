import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Point } from 'geojson';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { AvoPrediction } from '../../avo/domain/avo-prediction.entity';
import { MatchScore } from '../../lead-engine/domain/match-score.entity';
import { SocialPost } from '../../social-media/domain/social-post.entity';
import { FxSource, OperationType, PropertyStatus, PropertyType } from './property.enums';

export * from './property.enums';

@Entity('properties')
@Index('idx_property_location', ['location'], { spatial: true })
@Index(['neighborhood', 'status'])
export class Property {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: PropertyType })
  type: PropertyType;

  @Column({ type: 'enum', enum: OperationType, default: OperationType.VENTA })
  operation: OperationType;

  @Column({ type: 'enum', enum: PropertyStatus, default: PropertyStatus.DISPONIBLE })
  status: PropertyStatus;

  // ---------- Dirección y geolocalización (PostGIS) ----------
  @Column() address: string;
  @Column() neighborhood: string; // barrio
  @Column() city: string;
  @Column() province: string;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  location?: Point; // GeoJSON [lng, lat]

  // ---------- Características ----------
  @Column({ name: 'covered_m2', type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  coveredM2: number;

  @Column({ name: 'total_m2', type: 'numeric', precision: 10, scale: 2, transformer: numericTransformer })
  totalM2: number;

  @Column({ type: 'smallint', default: 0 }) rooms: number; // ambientes
  @Column({ type: 'smallint', default: 0 }) bedrooms: number;
  @Column({ type: 'smallint', default: 0 }) bathrooms: number;
  @Column({ name: 'garage_spots', type: 'smallint', default: 0 }) garageSpots: number;
  @Column({ name: 'age_years', type: 'smallint', nullable: true }) ageYears?: number;
  @Column({ type: 'jsonb', default: () => "'[]'" }) amenities: string[];
  @Column({ name: 'photo_urls', type: 'jsonb', default: () => "'[]'" }) photoUrls: string[];

  // ---------- Regla bimonetaria obligatoria ----------
  @Column({ name: 'price_usd', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  priceUsd: number;

  @Column({ name: 'price_ars', type: 'numeric', precision: 18, scale: 2, transformer: numericTransformer })
  priceArs: number;

  /** Pesos por cada dólar al momento de calcular priceArs. */
  @Column({ name: 'fx_rate', type: 'numeric', precision: 12, scale: 4, transformer: numericTransformer })
  fxRate: number;

  @Column({ name: 'fx_source', type: 'enum', enum: FxSource, default: FxSource.BLUE })
  fxSource: FxSource;

  @Column({ name: 'fx_rate_date', type: 'date' })
  fxRateDate: string; // YYYY-MM-DD

  /** Mantiene coherencia: priceArs = priceUsd * fxRate. El USD es la fuente de verdad. */
  @BeforeInsert()
  @BeforeUpdate()
  syncArsPrice() {
    if (this.priceUsd != null && this.fxRate != null) {
      this.priceArs = Math.round(this.priceUsd * this.fxRate * 100) / 100;
    }
  }

  @OneToMany(() => AvoPrediction, (p) => p.property)
  predictions: AvoPrediction[];

  @OneToMany(() => MatchScore, (m) => m.property)
  matches: MatchScore[];

  @OneToMany(() => SocialPost, (s) => s.property)
  socialPosts: SocialPost[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
