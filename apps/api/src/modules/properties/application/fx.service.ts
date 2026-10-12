import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { firstValueFrom, timeout } from 'rxjs';
import { FxSource } from '../domain/property.enums';

interface Quote {
  rate: number; // pesos por dólar (precio de venta)
  date: string; // YYYY-MM-DD (hora Argentina)
}

/** Ruta de cada cotización en DolarApi (https://dolarapi.com). Verificar contra su documentación vigente. */
const PATHS: Record<FxSource, string> = {
  [FxSource.BLUE]: 'blue',
  [FxSource.OFICIAL]: 'oficial',
  [FxSource.MEP]: 'bolsa',
  [FxSource.CCL]: 'contadoconliqui',
};

const CACHE_TTL_MS = 30 * 60 * 1000;

export function todayInArgentina(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly cache = new Map<FxSource, { quote: Quote; at: number }>();

  constructor(private readonly http: HttpService) {}

  async getRate(source: FxSource): Promise<Quote> {
    const hit = this.cache.get(source);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.quote;

    try {
      const res = await firstValueFrom(
        this.http.get<{ venta: number }>(`https://dolarapi.com/v1/dolares/${PATHS[source]}`).pipe(timeout(8000)),
      );
      const rate = Number(res.data.venta);
      if (!rate || rate <= 0) throw new Error('Cotización inválida en la respuesta');
      const quote = { rate, date: todayInArgentina() };
      this.cache.set(source, { quote, at: Date.now() });
      return quote;
    } catch (err) {
      this.logger.error(`No se pudo obtener el dólar ${source}: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        `No pude obtener la cotización del dólar ${source} en este momento. Probá de nuevo o enviá fxRate manualmente.`,
      );
    }
  }
}
