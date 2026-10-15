import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IndexPoint {
  date: string; // YYYY-MM-DD (IPC: primer día del mes)
  value: number;
}

const TIMEOUT_MS = 30_000;

/**
 * Fuentes oficiales y gratuitas (sin clave):
 * - ICL: API de Estadísticas del BCRA v4, variable 40 ("Índice para Contratos de Locación", diario).
 * - IPC: API de Series de Tiempo de datos.gob.ar, serie 148.3_INIVELNAL_DICI_M_26 (IPC nacional, INDEC, mensual).
 *   Esta API suele cargar el IPC con algunas semanas de atraso respecto de la publicación del INDEC.
 */
@Injectable()
export class IndexSources {
  constructor(private readonly config: ConfigService) {}

  async icl(from: string, to: string): Promise<IndexPoint[]> {
    const base = (this.config.get<string>('BCRA_API_URL') || 'https://api.bcra.gob.ar').replace(/\/+$/, '');
    const out: IndexPoint[] = [];
    // La API pagina de a 1000 registros (≈ 2,7 años de datos diarios)
    for (let offset = 0; ; offset += 1000) {
      const url = `${base}/estadisticas/v4.0/Monetarias/40?desde=${from}&hasta=${to}&limit=1000&offset=${offset}`;
      const body = (await this.get(url)) as { results?: { detalle?: { fecha: string; valor: number }[] }[] };
      const rows = body.results?.[0]?.detalle ?? [];
      out.push(...rows.map((r) => ({ date: r.fecha, value: Number(r.valor) })));
      if (rows.length < 1000) break;
    }
    return out.filter((p) => Number.isFinite(p.value) && p.value > 0);
  }

  async ipc(fromMonth: string): Promise<IndexPoint[]> {
    const base = (this.config.get<string>('SERIES_API_URL') || 'https://apis.datos.gob.ar/series/api').replace(/\/+$/, '');
    const url = `${base}/series/?ids=148.3_INIVELNAL_DICI_M_26&start_date=${fromMonth}&limit=1000&format=json`;
    const body = (await this.get(url)) as { data?: [string, number | null][] };
    return (body.data ?? []).filter((r): r is [string, number] => typeof r[1] === 'number' && r[1] > 0).map(([date, value]) => ({ date, value }));
  }

  private async get(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${new URL(url).host} respondió ${res.status}`);
    return res.json();
  }
}
