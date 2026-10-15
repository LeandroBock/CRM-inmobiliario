import { AdjustmentIndex } from './rental.enums';

/**
 * Cálculos de alquileres sin base de datos (fechas YYYY-MM-DD, montos en la moneda del contrato).
 * Los índices se piden con funciones para poder probarlos sin la API del BCRA ni del INDEC.
 */

export interface IndexLookup {
  /** ICL publicado ese día exacto (null si no está). */
  iclOn(date: string): number | null;
  /** IPC de un mes (YYYY-MM-01), o null si no está. */
  ipcOf(month: string): number | null;
  /** Último mes con IPC cargado (YYYY-MM-01). */
  latestIpcMonth(): string | null;
}

export interface AdjustmentInput {
  index: AdjustmentIndex;
  everyMonths: number;
  fixedRatePct?: number | null;
  currentRent: number;
  /** Base del cálculo: último ajuste o inicio del contrato. */
  lastAdjustmentDate: string;
  /** Fecha en que rige el ajuste. */
  adjustmentDate: string;
}

export type AdjustmentResult =
  | { ok: true; factor: number; newRent: number; detail: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Meses de atraso de IPC que se aceptan respecto del mes anterior al ajuste: el INDEC publica a mitad del mes
 * siguiente, así que al principio de mes puede faltar todavía el del mes pasado.
 */
const IPC_MAX_LAG_MONTHS = 1;

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate(); // 31/1 + 1 mes = 28 o 29/2
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
const pad = (n: number) => String(n).padStart(2, '0');

/** Próxima fecha de ajuste, o null si cae después del fin del contrato o no hay ajuste periódico. */
export function nextAdjustmentDate(lastAdjustmentDate: string, everyMonths: number, endDate: string): string | null {
  if (!everyMonths || everyMonths < 1) return null;
  const next = addMonths(lastAdjustmentDate, everyMonths);
  return next < endDate ? next : null;
}

export function computeAdjustment(input: AdjustmentInput, idx: IndexLookup): AdjustmentResult {
  let factor: number;
  let detail: Record<string, unknown>;

  switch (input.index) {
    case AdjustmentIndex.ICL: {
      // Método del BCRA: ICL del día del ajuste / ICL del día del último ajuste (o del inicio)
      const from = idx.iclOn(input.lastAdjustmentDate);
      const to = idx.iclOn(input.adjustmentDate);
      if (from === null) return { ok: false, reason: `Falta el ICL del ${formatDate(input.lastAdjustmentDate)}` };
      if (to === null) return { ok: false, reason: `El ICL del ${formatDate(input.adjustmentDate)} todavía no está publicado` };
      factor = to / from;
      detail = { from: { date: input.lastAdjustmentDate, value: from }, to: { date: input.adjustmentDate, value: to } };
      break;
    }
    case AdjustmentIndex.IPC: {
      // Variación de los últimos N meses publicados antes del ajuste: IPC(fin) / IPC(fin - N)
      const latest = idx.latestIpcMonth();
      const limit = addMonths(monthOf(input.adjustmentDate), -1);
      const end = latest && latest <= limit ? latest : latest ? limit : null;
      if (!end || idx.ipcOf(end) === null) {
        return { ok: false, reason: `Falta el IPC de ${formatMonth(limit)}: cargalo a mano si ya lo publicó el INDEC` };
      }
      if (end < addMonths(limit, -IPC_MAX_LAG_MONTHS)) {
        return { ok: false, reason: `El último IPC cargado es de ${formatMonth(end)}: cargá los meses que faltan` };
      }
      const start = addMonths(end, -input.everyMonths);
      const from = idx.ipcOf(start);
      const to = idx.ipcOf(end)!;
      if (from === null) return { ok: false, reason: `Falta el IPC de ${formatMonth(start)}` };
      factor = to / from;
      detail = { from: { month: start, value: from }, to: { month: end, value: to }, months: input.everyMonths };
      break;
    }
    case AdjustmentIndex.FIJO: {
      if (input.fixedRatePct == null) return { ok: false, reason: 'El contrato no tiene cargado el porcentaje de ajuste' };
      factor = 1 + input.fixedRatePct / 100;
      detail = { pct: input.fixedRatePct };
      break;
    }
    default:
      return { ok: false, reason: 'Este contrato no tiene índice: ingresá el nuevo monto pactado' };
  }
  return { ok: true, factor: round(factor, 6), newRent: Math.round(input.currentRent * factor), detail };
}

export interface PeriodStatus {
  /** YYYY-MM-01 */
  period: string;
  /** Fecha de vencimiento del pago de ese mes. */
  dueDate: string;
  due: number;
  paid: number;
  /** Lo que falta pagar (0 si está pago o si todavía no venció y no se pagó nada... ver `overdue`). */
  balance: number;
  /** Venció y no está pago completo. */
  overdue: boolean;
}

/**
 * Estado mes por mes, desde el inicio del contrato hasta el mes de `today` (o el fin del contrato).
 * El monto de cada mes es el alquiler vigente al primer día de ese mes (según los ajustes aplicados).
 */
export function periodsStatus(opts: {
  startDate: string;
  endDate: string;
  initialRent: number;
  paymentDueDay: number;
  adjustments: { effectiveDate: string; newRent: number }[];
  payments: { period: string; amount: number }[];
  today: string;
}): PeriodStatus[] {
  const out: PeriodStatus[] = [];
  const adjustments = [...opts.adjustments].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const lastMonth = monthOf(opts.today < opts.endDate ? opts.today : addMonths(opts.endDate, 0));
  for (let period = monthOf(opts.startDate); period <= lastMonth; period = addMonths(period, 1)) {
    let due = opts.initialRent;
    for (const a of adjustments) if (monthOf(a.effectiveDate) <= period) due = a.newRent;
    const paid = round(opts.payments.filter((p) => p.period === period).reduce((s, p) => s + p.amount, 0), 2);
    const day = `${period.slice(0, 8)}${pad(Math.min(28, Math.max(1, opts.paymentDueDay)))}`;
    // Un contrato que empieza el 15 no puede tener el primer vencimiento el 10 de ese mes
    const dueDate = day < opts.startDate ? opts.startDate : day;
    const balance = round(Math.max(0, due - paid), 2);
    out.push({ period, dueDate, due, paid, balance, overdue: balance > 0 && opts.today > dueDate });
  }
  return out;
}

const round = (n: number, decimals: number) => Math.round(n * 10 ** decimals) / 10 ** decimals;
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function formatMonth(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
