import { addMonths, computeAdjustment, IndexLookup, nextAdjustmentDate, periodsStatus } from './rent-calc';
import { AdjustmentIndex } from './rental.enums';

const lookup = (icl: Record<string, number>, ipc: Record<string, number>): IndexLookup => ({
  iclOn: (d) => icl[d] ?? null,
  ipcOf: (m) => ipc[m] ?? null,
  latestIpcMonth: () => Object.keys(ipc).sort().at(-1) ?? null,
});

describe('cálculo de alquileres', () => {
  it('suma meses respetando fin de mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 4)).toBe('2027-03-15');
    expect(addMonths('2026-03-01', -3)).toBe('2025-12-01');
  });

  it('próximo ajuste: nunca después del fin del contrato', () => {
    expect(nextAdjustmentDate('2026-01-01', 4, '2028-01-01')).toBe('2026-05-01');
    expect(nextAdjustmentDate('2027-10-01', 4, '2028-01-01')).toBeNull();
    expect(nextAdjustmentDate('2026-01-01', 0, '2028-01-01')).toBeNull();
  });

  const base = { everyMonths: 4, currentRent: 500_000, lastAdjustmentDate: '2026-06-15', adjustmentDate: '2026-10-15' };

  it('ICL: cociente entre el día del ajuste y el del último ajuste', () => {
    const r = computeAdjustment({ ...base, index: AdjustmentIndex.ICL }, lookup({ '2026-06-15': 32, '2026-10-15': 36.86 }, {}));
    expect(r).toMatchObject({ ok: true, factor: 1.151875, newRent: 575_938 });
  });

  it('ICL sin publicar todavía: lo dice', () => {
    const r = computeAdjustment({ ...base, index: AdjustmentIndex.ICL }, lookup({ '2026-06-15': 32 }, {}));
    expect(r).toEqual({ ok: false, reason: 'El ICL del 15/10/2026 todavía no está publicado' });
  });

  it('IPC: variación de los últimos N meses publicados antes del ajuste', () => {
    const ipc = { '2026-05-01': 100, '2026-06-01': 102, '2026-07-01': 104, '2026-08-01': 106, '2026-09-01': 108 };
    const r = computeAdjustment({ ...base, index: AdjustmentIndex.IPC }, lookup({}, ipc));
    // ajuste 15/10: último mes publicado septiembre; 4 meses antes: mayo
    expect(r).toMatchObject({ ok: true, factor: 1.08, newRent: 540_000, detail: { from: { month: '2026-05-01' }, to: { month: '2026-09-01' } } });
  });

  it('IPC con meses de más: usa el mes anterior al ajuste', () => {
    const ipc = { '2026-05-01': 100, '2026-09-01': 108, '2026-10-01': 110 };
    expect(computeAdjustment({ ...base, index: AdjustmentIndex.IPC }, lookup({}, ipc))).toMatchObject({ ok: true, factor: 1.08 });
  });

  it('IPC atrasado: pide cargar los meses que faltan', () => {
    const r = computeAdjustment({ ...base, index: AdjustmentIndex.IPC }, lookup({}, { '2026-03-01': 90, '2026-07-01': 104 }));
    expect(r).toEqual({ ok: false, reason: 'El último IPC cargado es de julio 2026: cargá los meses que faltan' });
  });

  it('porcentaje fijo y sin índice', () => {
    expect(computeAdjustment({ ...base, index: AdjustmentIndex.FIJO, fixedRatePct: 10 }, lookup({}, {}))).toMatchObject({ ok: true, newRent: 550_000 });
    expect(computeAdjustment({ ...base, index: AdjustmentIndex.NINGUNO }, lookup({}, {}))).toMatchObject({ ok: false });
  });

  it('estado mes por mes: monto vigente, pagos parciales y vencidos', () => {
    const periods = periodsStatus({
      startDate: '2026-07-01',
      endDate: '2028-07-01',
      initialRent: 500_000,
      paymentDueDay: 10,
      adjustments: [{ effectiveDate: '2026-09-01', newRent: 550_000 }],
      payments: [
        { period: '2026-07-01', amount: 500_000 },
        { period: '2026-08-01', amount: 300_000 },
        { period: '2026-09-01', amount: 550_000 },
      ],
      today: '2026-10-05',
    });
    expect(periods.map((p) => [p.period, p.due, p.balance, p.overdue])).toEqual([
      ['2026-07-01', 500_000, 0, false],
      ['2026-08-01', 500_000, 200_000, true],
      ['2026-09-01', 550_000, 0, false],
      ['2026-10-01', 550_000, 550_000, false], // vence el 10
    ]);
  });
});
