/**
 * Tasación por comparables: a partir del USD/m² de propiedades parecidas, estima el valor de otra.
 * Funciones puras (sin base de datos) para poder probarlas con números conocidos.
 */

export type Confidence = 'alta' | 'media' | 'baja';

export interface ComparablesEstimate {
  /** USD/m² típico (mediana, sin valores extremos). */
  pricePerM2Usd: number;
  estimatedPriceUsd: number;
  rangeLowUsd: number;
  rangeHighUsd: number;
  confidence: Confidence;
  /** Comparables que quedaron después de sacar los valores extremos. */
  used: number;
  /** Índices (en la lista recibida) de los que se descartaron por extremos. */
  outliers: number[];
}

/** Cuartil por interpolación lineal (como PERCENTIL de una planilla). `sorted` ordenado de menor a mayor. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Redondeo "de tasador": a 1.000 en ventas, a 100 o a 10 en valores chicos (alquileres en USD). */
export function roundPrice(value: number): number {
  const step = value >= 100_000 ? 1000 : value >= 10_000 ? 100 : 10;
  return Math.round(value / step) * step;
}

/**
 * @param areaM2 superficie cubierta de la propiedad a tasar
 * @param pricesPerM2 USD/m² de cada comparable (mismo orden que la lista de comparables)
 * @returns null si hay menos de 3 comparables (muy pocos para estimar)
 */
export function estimateFromComparables(areaM2: number, pricesPerM2: number[]): ComparablesEstimate | null {
  const valid = pricesPerM2.map((v, i) => ({ v, i })).filter(({ v }) => Number.isFinite(v) && v > 0);
  if (valid.length < 3 || !(areaM2 > 0)) return null;

  // Valores extremos (regla de Tukey): solo con 5 o más, para no quedarse sin datos.
  let kept = valid;
  if (valid.length >= 5) {
    const s = valid.map((x) => x.v).sort((a, b) => a - b);
    const q1 = quantile(s, 0.25);
    const q3 = quantile(s, 0.75);
    const iqr = q3 - q1;
    kept = valid.filter(({ v }) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  }
  const outliers = valid.filter((x) => !kept.includes(x)).map((x) => x.i);

  const sorted = kept.map((x) => x.v).sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  // Rango: el 50 % central de las comparables; con muy pocas, de la más barata a la más cara.
  const low = sorted.length >= 4 ? quantile(sorted, 0.25) : sorted[0];
  const high = sorted.length >= 4 ? quantile(sorted, 0.75) : sorted[sorted.length - 1];

  const spread = (high - low) / median;
  const confidence: Confidence = sorted.length >= 8 && spread <= 0.3 ? 'alta' : sorted.length >= 5 && spread <= 0.5 ? 'media' : 'baja';

  return {
    pricePerM2Usd: Math.round(median),
    estimatedPriceUsd: roundPrice(median * areaM2),
    rangeLowUsd: roundPrice(low * areaM2),
    rangeHighUsd: roundPrice(high * areaM2),
    confidence,
    used: sorted.length,
    outliers,
  };
}
