import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { IndexValue } from '../domain/index-value.entity';
import { addMonths, IndexLookup, monthOf } from '../domain/rent-calc';
import { IndexCode } from '../domain/rental.enums';
import { IndexSources } from '../infrastructure/index-sources';

/** Primer dato del ICL (base 30/6/2020 = 1). */
const ICL_FIRST = '2020-07-01';

@Injectable()
export class IndexService {
  private readonly logger = new Logger(IndexService.name);

  constructor(
    @InjectRepository(IndexValue) private readonly values: Repository<IndexValue>,
    private readonly sources: IndexSources,
  ) {}

  /** Descarga lo que falte de ICL e IPC. Si una fuente falla, sigue con la otra y lo deja en el log. */
  async sync(today = todayAr()): Promise<{ icl: number; ipc: number; errors: string[] }> {
    const errors: string[] = [];
    let icl = 0;
    let ipc = 0;
    try {
      const last = await this.latest(IndexCode.ICL);
      // Repasa los últimos 10 días por si el BCRA corrigió algún valor
      const from = last ? addDays(last.date, -10) : ICL_FIRST;
      icl = await this.save(IndexCode.ICL, await this.sources.icl(from, today), 'bcra');
    } catch (err) {
      errors.push(`ICL: ${(err as Error).message}`);
    }
    try {
      const last = await this.latest(IndexCode.IPC);
      ipc = await this.save(IndexCode.IPC, await this.sources.ipc(last ? addMonths(last.date, -3) : '2017-01-01'), 'indec');
    } catch (err) {
      errors.push(`IPC: ${(err as Error).message}`);
    }
    if (errors.length) this.logger.warn(`No se pudieron actualizar los índices: ${errors.join(' · ')}`);
    return { icl, ipc, errors };
  }

  latest(index: IndexCode): Promise<IndexValue | null> {
    return this.values.findOne({ where: { index }, order: { date: 'DESC' } });
  }

  /** Últimos valores, para mostrar en pantalla. */
  recent(index: IndexCode, count: number): Promise<IndexValue[]> {
    return this.values.find({ where: { index }, order: { date: 'DESC' }, take: count });
  }

  /** Carga a mano (p. ej. el IPC que el INDEC ya publicó pero la API todavía no tiene). Pisa el valor si existía. */
  async setManual(index: IndexCode, date: string, value: number): Promise<IndexValue> {
    const day = index === IndexCode.IPC ? monthOf(date) : date;
    await this.values.upsert({ index, date: day, value, source: 'manual' }, ['index', 'date']);
    return this.values.findOneByOrFail({ index, date: day });
  }

  /**
   * Los valores que puede necesitar el cálculo de un ajuste, en memoria (unas decenas de filas).
   * ICL: los días pedidos; IPC: los últimos 30 meses.
   */
  async lookupFor(iclDates: string[], untilMonth: string): Promise<IndexLookup> {
    const icl = new Map<string, number>();
    if (iclDates.length) {
      const rows = await this.values.find({ where: iclDates.map((date) => ({ index: IndexCode.ICL, date })) });
      for (const r of rows) icl.set(r.date, r.value);
    }
    const ipcRows = await this.values.find({
      where: { index: IndexCode.IPC, date: Between(addMonths(untilMonth, -30), untilMonth) },
      order: { date: 'ASC' },
    });
    const ipc = new Map(ipcRows.map((r) => [r.date, r.value]));
    const latestIpc = await this.values.findOne({ where: { index: IndexCode.IPC, date: LessThanOrEqual(untilMonth) }, order: { date: 'DESC' } });
    return {
      iclOn: (d) => icl.get(d) ?? null,
      ipcOf: (m) => ipc.get(m) ?? null,
      latestIpcMonth: () => latestIpc?.date ?? null,
    };
  }

  private async save(index: IndexCode, points: { date: string; value: number }[], source: string): Promise<number> {
    if (!points.length) return 0; // el BCRA las devuelve de la más nueva a la más vieja: se busca la mínima
    // Lo cargado a mano no se pisa con la API (si difiere, manda lo que cargó la persona)
    const manual = new Set(
      (await this.values.find({ select: { date: true }, where: { index, source: 'manual', date: MoreThanOrEqual(points.reduce((m, p) => (p.date < m ? p.date : m), points[0].date)) } })).map((v) => v.date),
    );
    const rows = points.filter((p) => !manual.has(p.date)).map((p) => ({ index, date: p.date, value: p.value, source }));
    for (let i = 0; i < rows.length; i += 500) await this.values.upsert(rows.slice(i, i + 500), ['index', 'date']);
    return rows.length;
  }
}

/** Fecha de hoy en Argentina (UTC-3), YYYY-MM-DD. */
export function todayAr(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
