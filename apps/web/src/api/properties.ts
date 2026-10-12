export const PROPERTY_TYPES = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'casa', label: 'Casa' },
  { value: 'ph', label: 'PH' },
  { value: 'terreno', label: 'Terreno' },
  { value: 'local', label: 'Local' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'cochera', label: 'Cochera' },
] as const;

export const OPERATIONS = [
  { value: 'venta', label: 'Venta' },
  { value: 'alquiler', label: 'Alquiler' },
] as const;

export const STATUSES = [
  { value: 'disponible', label: 'Disponible' },
  { value: 'reservada', label: 'Reservada' },
  { value: 'vendida', label: 'Vendida' },
  { value: 'pausada', label: 'Pausada' },
] as const;

export const FX_SOURCES = [
  { value: 'blue', label: 'Dólar blue' },
  { value: 'oficial', label: 'Dólar oficial' },
  { value: 'mep', label: 'Dólar MEP' },
  { value: 'ccl', label: 'Contado con liqui' },
] as const;

export interface Property {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  operation: string;
  status: string;
  address: string;
  neighborhood: string;
  city: string;
  province: string;
  /** GeoJSON: [longitud, latitud] */
  location?: { type: 'Point'; coordinates: [number, number] } | null;
  coveredM2: number;
  totalM2: number;
  rooms: number;
  bedrooms: number;
  bathrooms: number;
  garageSpots: number;
  ageYears?: number | null;
  amenities: string[];
  photoUrls: string[];
  priceUsd: number;
  priceArs: number;
  /** Pesos por dólar usados para calcular priceArs. */
  fxRate: number;
  fxSource: string;
  /** YYYY-MM-DD */
  fxRateDate: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function labelOf(list: readonly { value: string; label: string }[], value: string): string {
  return list.find((i) => i.value === value)?.label ?? value;
}

const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const formatUsd = (n: number) => usd.format(n);
export const formatArs = (n: number) => ars.format(n);

/** "2026-10-11" -> "11/10" */
export function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/**
 * Interpreta un número escrito a la argentina. Devuelve null si está vacío y NaN si no es válido.
 *   "98.000" -> 98000      "98000" -> 98000     "98.000,50" -> 98000.5
 *   "52,5"   -> 52.5       "52.5"  -> 52.5      "1.500" -> 1500 (punto como separador de miles)
 */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s$]|USD|US\$|ARS/gi, '');
  if (s === '') return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+\.\d+$/.test(s)) return Number(s);
  return NaN;
}
