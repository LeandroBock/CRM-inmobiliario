import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { numericTransformer } from '../../../shared/infrastructure/numeric.transformer';
import { Property } from '../../properties/domain/property.entity';
import { AdjustmentIndex, ContractStatus, RentCurrency } from './rental.enums';
import type { RentalAdjustment } from './rental-adjustment.entity';
import type { RentalPayment } from './rental-payment.entity';

/** Contrato de alquiler administrado por la inmobiliaria. */
@Entity('rental_contracts')
export class RentalContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Property, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  // ---------- Partes (datos de contacto, sin cuentas en el CRM)
  @Column({ name: 'tenant_name' }) tenantName: string;
  @Column({ name: 'tenant_phone', type: 'varchar', nullable: true }) tenantPhone?: string | null;
  @Column({ name: 'tenant_email', type: 'varchar', nullable: true }) tenantEmail?: string | null;
  /** DNI o CUIT. */
  @Column({ name: 'tenant_document', type: 'varchar', nullable: true }) tenantDocument?: string | null;
  @Column({ name: 'owner_name' }) ownerName: string;
  @Column({ name: 'owner_phone', type: 'varchar', nullable: true }) ownerPhone?: string | null;
  @Column({ name: 'owner_email', type: 'varchar', nullable: true }) ownerEmail?: string | null;

  // ---------- Plazo y montos
  @Column({ name: 'start_date', type: 'date' }) startDate: string; // YYYY-MM-DD
  @Column({ name: 'end_date', type: 'date' }) endDate: string;
  @Column({ type: 'enum', enum: RentCurrency, default: RentCurrency.ARS }) currency: RentCurrency;
  @Column({ name: 'initial_rent', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) initialRent: number;
  /** Alquiler vigente (cambia con cada ajuste aplicado). */
  @Column({ name: 'current_rent', type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer }) currentRent: number;
  /** Día del mes en que vence el pago (1 a 28). */
  @Column({ name: 'payment_due_day', type: 'smallint', default: 10 }) paymentDueDay: number;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer }) deposit?: number | null;
  /** Comisión de administración que se le descuenta al propietario (%). */
  @Column({ name: 'admin_fee_pct', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer }) adminFeePct?: number | null;

  // ---------- Ajustes
  @Column({ name: 'adjustment_index', type: 'enum', enum: AdjustmentIndex, default: AdjustmentIndex.ICL }) adjustmentIndex: AdjustmentIndex;
  /** Cada cuántos meses se ajusta (3, 4, 6, 12...). */
  @Column({ name: 'adjustment_every_months', type: 'smallint', default: 12 }) adjustmentEveryMonths: number;
  /** Solo con índice "fijo": porcentaje por período. */
  @Column({ name: 'fixed_rate_pct', type: 'numeric', precision: 6, scale: 2, nullable: true, transformer: numericTransformer }) fixedRatePct?: number | null;
  /** Fecha del último ajuste aplicado (o el inicio del contrato): base del cálculo del próximo. */
  @Column({ name: 'last_adjustment_date', type: 'date' }) lastAdjustmentDate: string;
  @Index()
  @Column({ name: 'next_adjustment_date', type: 'date', nullable: true }) nextAdjustmentDate?: string | null;

  @Index()
  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.ACTIVO }) status: ContractStatus;
  @Column({ type: 'text', nullable: true }) notes?: string | null;

  @OneToMany('RentalAdjustment', 'contract') adjustments?: RentalAdjustment[];
  @OneToMany('RentalPayment', 'contract') payments?: RentalPayment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
