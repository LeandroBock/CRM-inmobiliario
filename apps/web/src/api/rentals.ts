import type { Property } from './properties';

export type AdjustmentIndex = 'icl' | 'ipc' | 'fijo' | 'ninguno';
export type ContractStatus = 'activo' | 'finalizado' | 'rescindido';
export type RentCurrency = 'ARS' | 'USD';

export const ADJUSTMENT_INDEXES: { value: AdjustmentIndex; label: string; hint: string }[] = [
  { value: 'icl', label: 'ICL (BCRA)', hint: 'Índice para Contratos de Locación, diario. Se descarga solo.' },
  { value: 'ipc', label: 'IPC (INDEC)', hint: 'Inflación mensual. Se descarga sola; si falta un mes, se carga a mano.' },
  { value: 'fijo', label: 'Porcentaje fijo', hint: 'Un % pactado por cada período.' },
  { value: 'ninguno', label: 'Sin índice', hint: 'El monto nuevo se ingresa a mano en cada ajuste.' },
];

export const CONTRACT_STATUSES: { value: ContractStatus; label: string; bg: string; fg: string }[] = [
  { value: 'activo', label: 'Activo', bg: '#d3f9d8', fg: '#2b8a3e' },
  { value: 'finalizado', label: 'Finalizado', bg: '#e7e9ee', fg: '#495057' },
  { value: 'rescindido', label: 'Rescindido', bg: '#ffe3e3', fg: '#c92a2a' },
];

export interface RentalContract {
  id: string;
  property: Pick<Property, 'id' | 'title' | 'address' | 'neighborhood' | 'city'>;
  tenantName: string;
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  tenantDocument?: string | null;
  ownerName: string;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  startDate: string;
  endDate: string;
  currency: RentCurrency;
  initialRent: number;
  currentRent: number;
  paymentDueDay: number;
  deposit?: number | null;
  adminFeePct?: number | null;
  adjustmentIndex: AdjustmentIndex;
  adjustmentEveryMonths: number;
  fixedRatePct?: number | null;
  lastAdjustmentDate: string;
  nextAdjustmentDate?: string | null;
  status: ContractStatus;
  notes?: string | null;
}

export interface PeriodStatus {
  period: string;
  dueDate: string;
  due: number;
  paid: number;
  balance: number;
  overdue: boolean;
}

export interface ContractSummary {
  contract: RentalContract;
  debt: number;
  overdueMonths: number;
  current: PeriodStatus | null;
}

export interface RentalAdjustment {
  id: string;
  effectiveDate: string;
  previousRent: number;
  newRent: number;
  factor: number;
  index: AdjustmentIndex;
  detail?: Record<string, any> | null;
  authorName?: string | null;
  createdAt: string;
}

export interface RentalPayment {
  id: string;
  period: string;
  amount: number;
  paidAt: string;
  method?: string | null;
  notes?: string | null;
  authorName?: string | null;
}

export type AdjustmentPreview =
  | { date: string; canApply: boolean; ok: true; factor: number; newRent: number; detail: Record<string, any> }
  | { date: string; canApply: boolean; ok: false; reason: string };

export interface ContractDetail extends RentalContract {
  adjustments: RentalAdjustment[];
  payments: RentalPayment[];
  periods: PeriodStatus[];
  debt: number;
  overdueMonths: number;
  nextAdjustment: AdjustmentPreview | null;
}

export interface IndexValue {
  index: 'icl' | 'ipc';
  date: string;
  value: number;
  source: string;
}

export function money(n: number, currency: RentCurrency = 'ARS'): string {
  return `${currency === 'USD' ? 'US$' : '$'} ${Math.round(n).toLocaleString('es-AR')}`;
}

export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function formatPeriod(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

export function pctChange(factor: number): string {
  const v = (factor - 1) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`;
}

/** Fecha de hoy en Argentina, YYYY-MM-DD. */
export function todayAr(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}
