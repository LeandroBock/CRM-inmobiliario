import { OPERATIONS, PROPERTY_TYPES, formatUsd, labelOf, type Property } from './api/properties';

/** Límite de título más chico entre los portales (MercadoLibre); Zonaprop y Argenprop aceptan algo más. */
export const TITLE_MAX = 60;

/** Sin emojis ni símbolos raros: los portales los rechazan o los muestran mal. */
export function plain(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "Departamento 2 ambientes en venta en Centro" (sin pasarse del límite). */
export function listingTitle(p: Property): string {
  const type = labelOf(PROPERTY_TYPES, p.type);
  const size = p.rooms ? `${p.rooms} ${p.rooms === 1 ? 'ambiente' : 'ambientes'}` : p.coveredM2 ? `${p.coveredM2} m²` : '';
  const op = p.operation === 'alquiler' ? 'en alquiler' : 'en venta';
  const candidates = [
    [type, size, op, `en ${p.neighborhood}`],
    [type, size, `en ${p.neighborhood}`],
    [type, op, `en ${p.neighborhood}`],
    [type, `en ${p.neighborhood}`],
  ];
  for (const parts of candidates) {
    const t = parts.filter(Boolean).join(' ');
    if (t.length <= TITLE_MAX) return t;
  }
  return `${type} en ${p.neighborhood}`.slice(0, TITLE_MAX);
}

/** Descripción en texto plano con los datos cargados (sin teléfonos ni dirección exacta). */
export function listingDescription(p: Property): string {
  const type = labelOf(PROPERTY_TYPES, p.type).toLowerCase();
  const op = p.operation === 'alquiler' ? 'en alquiler' : 'en venta';
  const intro = `${capitalize(type)} ${op} en ${p.neighborhood}, ${p.city}.`;
  const own = plain(p.description ?? '');
  const features = [
    p.coveredM2 ? `${p.coveredM2} m² cubiertos${p.totalM2 && p.totalM2 !== p.coveredM2 ? ` (${p.totalM2} m² totales)` : ''}` : null,
    p.rooms ? `${p.rooms} ${p.rooms === 1 ? 'ambiente' : 'ambientes'}` : null,
    p.bedrooms ? `${p.bedrooms} ${p.bedrooms === 1 ? 'dormitorio' : 'dormitorios'}` : null,
    p.bathrooms ? `${p.bathrooms} ${p.bathrooms === 1 ? 'baño' : 'baños'}` : null,
    p.garageSpots ? `${p.garageSpots} ${p.garageSpots === 1 ? 'cochera' : 'cocheras'}` : null,
    p.ageYears === 0 ? 'A estrenar' : p.ageYears ? `Antigüedad: ${p.ageYears} años` : null,
  ].filter(Boolean);
  return [
    intro,
    own,
    features.length ? `Características:\n${features.map((f) => `- ${f}`).join('\n')}` : '',
    p.amenities?.length ? `Comodidades: ${p.amenities.join(', ')}.` : '',
    'Consultanos para coordinar una visita.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Datos en el orden en que los piden los formularios de los portales: [nombre, lo que se ve, lo que se copia].
 * En los campos numéricos se copia solo el número (los formularios no aceptan "60 m²" ni "US$").
 */
export function listingFields(p: Property): [string, string, string][] {
  const rows: [string, string | number | null | undefined][] = [
    ['Operación', labelOf(OPERATIONS, p.operation)],
    ['Tipo de propiedad', labelOf(PROPERTY_TYPES, p.type)],
    ['Precio', `${formatUsd(p.priceUsd)} (dólares)`],
    ['Provincia', p.province],
    ['Ciudad / Localidad', p.city],
    ['Barrio', p.neighborhood],
    ['Dirección', p.address],
    ['Superficie cubierta', p.coveredM2 ? `${p.coveredM2} m²` : null],
    ['Superficie total', p.totalM2 ? `${p.totalM2} m²` : null],
    ['Ambientes', p.rooms || null],
    ['Dormitorios', p.bedrooms || null],
    ['Baños', p.bathrooms || null],
    ['Cocheras', p.garageSpots || null],
    ['Antigüedad', p.ageYears === 0 ? 'A estrenar' : p.ageYears != null ? `${p.ageYears} años` : null],
    ['Comodidades', p.amenities?.length ? p.amenities.join(', ') : null],
  ];
  const numeric: Record<string, number> = { Precio: p.priceUsd, 'Superficie cubierta': p.coveredM2, 'Superficie total': p.totalM2 };
  return rows
    .filter((r): r is [string, string | number] => r[1] != null && r[1] !== '')
    .map(([k, v]) => [k, String(v), k in numeric ? String(numeric[k]) : String(v)]);
}

/** Fotos mínimas que recomienda Zonaprop según el tipo (más fotos = más contactos). */
export function recommendedPhotos(p: Property): number {
  if (['local', 'oficina', 'terreno', 'cochera'].includes(p.type)) return 7;
  return p.rooms >= 2 ? 18 : 10;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
