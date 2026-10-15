import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { IndexCode } from './rental.enums';

/**
 * Valores de los índices de ajuste. ICL: uno por día (BCRA). IPC: uno por mes, con fecha del primer día (INDEC).
 * Se descargan solos; si el IPC de un mes todavía no está publicado en la API, se puede cargar a mano.
 */
@Entity('index_values')
export class IndexValue {
  @PrimaryColumn({ type: 'enum', enum: IndexCode }) index: IndexCode;
  @PrimaryColumn({ type: 'date' }) date: string;
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericTransformer }) value: number;
  /** 'bcra', 'indec' o 'manual'. */
  @Column({ default: 'manual' }) source: string;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
