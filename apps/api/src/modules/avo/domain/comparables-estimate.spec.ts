import { estimateFromComparables, quantile, roundPrice } from './comparables-estimate';

describe('tasación por comparables', () => {
  it('mediana del USD/m² por la superficie, con el rango del 50 % central', () => {
    // 8 comparables entre 1.800 y 2.200 USD/m²
    const r = estimateFromComparables(50, [1800, 1900, 1950, 2000, 2000, 2050, 2100, 2200])!;
    expect(r.pricePerM2Usd).toBe(2000);
    expect(r.estimatedPriceUsd).toBe(100_000);
    expect(r.rangeLowUsd).toBe(96_900); // Q1 = 1937,5 × 50 = 96.875
    expect(r.rangeHighUsd).toBe(103_000); // Q3 = 2062,5 × 50 = 103.125
    expect(r.confidence).toBe('alta');
    expect(r.used).toBe(8);
  });

  it('descarta valores extremos (una publicación mal cargada no arruina la tasación)', () => {
    const r = estimateFromComparables(50, [2000, 2100, 1900, 2050, 1950, 20000, 300])!;
    expect(r.outliers.sort()).toEqual([5, 6]);
    expect(r.used).toBe(5);
    expect(r.pricePerM2Usd).toBe(2000);
  });

  it('con pocas comparables, el rango va de la más barata a la más cara y la confianza es baja', () => {
    const r = estimateFromComparables(40, [1500, 2000, 2500])!;
    expect(r).toMatchObject({ pricePerM2Usd: 2000, estimatedPriceUsd: 80_000, rangeLowUsd: 60_000, rangeHighUsd: 100_000, confidence: 'baja' });
  });

  it('muchas comparables pero muy dispersas: confianza media o baja, no alta', () => {
    const r = estimateFromComparables(50, [1000, 1400, 1800, 2200, 2600, 3000, 3400, 3800])!;
    expect(r.confidence).not.toBe('alta');
  });

  it('menos de 3 comparables o superficie inválida: no estima', () => {
    expect(estimateFromComparables(50, [2000, 2100])).toBeNull();
    expect(estimateFromComparables(0, [2000, 2100, 2200])).toBeNull();
    expect(estimateFromComparables(50, [2000, NaN, 0, -5])).toBeNull();
  });

  it('redondeo según el monto (a 1.000 desde USD 100.000; a 100 o a 10 en montos chicos, como alquileres)', () => {
    expect(roundPrice(98_765)).toBe(98_800);
    expect(roundPrice(123_456)).toBe(123_000);
    expect(roundPrice(12_345)).toBe(12_300);
    expect(roundPrice(487)).toBe(490);
  });

  it('cuartiles como en una planilla', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.25)).toBe(10);
  });
});
