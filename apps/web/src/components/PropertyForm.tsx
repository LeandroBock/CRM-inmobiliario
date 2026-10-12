import { useCallback, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import {
  FX_SOURCES,
  OPERATIONS,
  PROPERTY_TYPES,
  STATUSES,
  formatArs,
  formatShortDate,
  formatUsd,
  parseAmount,
  type Property,
} from '../api/properties';
import { btnPrimary, btnSecondary, colors, input } from '../styles';
import PhotoManager from './PhotoManager';

interface Props {
  /** null = alta; con una propiedad = edición. */
  property: Property | null;
  onSaved: (saved: Property) => void;
  onCancel: () => void;
}

interface FormState {
  title: string;
  description: string;
  type: string;
  operation: string;
  status: string;
  address: string;
  neighborhood: string;
  city: string;
  province: string;
  lat: string;
  lng: string;
  coveredM2: string;
  totalM2: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  garageSpots: string;
  ageYears: string;
  amenities: string;
  photoUrls: string[];
  currency: 'USD' | 'ARS';
  price: string;
  fxSource: string;
  fxRate: string;
}

function initialState(p: Property | null): FormState {
  if (!p) {
    return {
      title: '', description: '', type: 'departamento', operation: 'venta', status: 'disponible',
      address: '', neighborhood: '', city: '', province: '', lat: '', lng: '',
      coveredM2: '', totalM2: '', rooms: '', bedrooms: '', bathrooms: '', garageSpots: '', ageYears: '',
      amenities: '', photoUrls: [], currency: 'USD', price: '', fxSource: 'blue', fxRate: '',
    };
  }
  return {
    title: p.title, description: p.description ?? '', type: p.type, operation: p.operation, status: p.status,
    address: p.address, neighborhood: p.neighborhood, city: p.city, province: p.province,
    lat: p.location ? String(p.location.coordinates[1]) : '',
    lng: p.location ? String(p.location.coordinates[0]) : '',
    coveredM2: String(p.coveredM2), totalM2: String(p.totalM2),
    rooms: String(p.rooms), bedrooms: String(p.bedrooms), bathrooms: String(p.bathrooms),
    garageSpots: String(p.garageSpots), ageYears: p.ageYears != null ? String(p.ageYears) : '',
    amenities: p.amenities.join(', '), photoUrls: [...p.photoUrls],
    currency: 'USD', price: String(p.priceUsd), fxSource: p.fxSource, fxRate: '',
  };
}

/** Número entero >= 0; vacío cuenta como 0. Devuelve el número o un mensaje de error. */
function intField(raw: string, name: string): number | string {
  const s = raw.trim();
  if (s === '') return 0;
  return /^\d+$/.test(s) ? Number(s) : `${name} tiene que ser un número entero`;
}

function validAmount(raw: string): number | null {
  const n = parseAmount(raw);
  return n === null || Number.isNaN(n) || n < 0 ? null : n;
}

function buildPayload(f: FormState, original: Property | null): { payload?: Record<string, unknown>; error?: string } {
  if (f.title.trim().length < 3) return { error: 'El título debe tener al menos 3 caracteres' };
  if (!f.address.trim()) return { error: 'Completá la dirección' };
  if (!f.neighborhood.trim()) return { error: 'Completá el barrio' };
  if (!f.city.trim()) return { error: 'Completá la ciudad' };
  if (!f.province.trim()) return { error: 'Completá la provincia' };

  const covered = validAmount(f.coveredM2);
  const total = validAmount(f.totalM2);
  if (covered === null) return { error: 'Indicá los m² cubiertos (un número válido, 0 si es un terreno)' };
  if (total === null) return { error: 'Indicá los m² totales (un número válido)' };
  if (total < covered) return { error: 'Los m² totales no pueden ser menores a los cubiertos' };

  const rooms = intField(f.rooms, 'Ambientes');
  const bedrooms = intField(f.bedrooms, 'Dormitorios');
  const bathrooms = intField(f.bathrooms, 'Baños');
  const garageSpots = intField(f.garageSpots, 'Cocheras');
  for (const v of [rooms, bedrooms, bathrooms, garageSpots]) if (typeof v === 'string') return { error: v };

  let ageYears: number | undefined;
  if (f.ageYears.trim() !== '') {
    const a = intField(f.ageYears, 'La antigüedad');
    if (typeof a === 'string') return { error: a };
    ageYears = a;
  }

  // Coordenadas: las dos o ninguna.
  const latS = f.lat.trim();
  const lngS = f.lng.trim();
  let lat: number | undefined;
  let lng: number | undefined;
  if (latS || lngS) {
    if (!latS || !lngS) return { error: 'Cargá latitud y longitud juntas (o dejá las dos vacías)' };
    lat = Number(latS.replace(',', '.'));
    lng = Number(lngS.replace(',', '.'));
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return { error: 'La latitud tiene que estar entre -90 y 90' };
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) return { error: 'La longitud tiene que estar entre -180 y 180' };
  }

  // Precio
  const price = validAmount(f.price);
  if (price === null || price <= 0) return { error: 'Indicá un precio mayor a cero' };
  const fxManual = f.fxRate.trim() === '' ? null : validAmount(f.fxRate);
  if (f.fxRate.trim() !== '' && (fxManual === null || fxManual <= 0)) return { error: 'La cotización manual no es un número válido' };

  const payload: Record<string, unknown> = {
    title: f.title.trim(),
    description: f.description.trim(),
    type: f.type,
    operation: f.operation,
    status: f.status,
    address: f.address.trim(),
    neighborhood: f.neighborhood.trim(),
    city: f.city.trim(),
    province: f.province.trim(),
    coveredM2: covered,
    totalM2: total,
    rooms,
    bedrooms,
    bathrooms,
    garageSpots,
    amenities: f.amenities.split(',').map((s) => s.trim()).filter(Boolean),
    photoUrls: f.photoUrls,
  };
  if (ageYears !== undefined) payload.ageYears = ageYears;
  if (lat !== undefined && lng !== undefined) {
    payload.lat = lat;
    payload.lng = lng;
  }

  // Al editar, el bloque de precio solo se envía si el usuario lo tocó: así no se pisa la cotización guardada.
  const pricingTouched =
    !original ||
    f.currency !== 'USD' ||
    price !== original.priceUsd ||
    f.fxSource !== original.fxSource ||
    fxManual !== null;
  if (pricingTouched) {
    payload[f.currency === 'USD' ? 'priceUsd' : 'priceArs'] = price;
    payload.fxSource = f.fxSource;
    if (fxManual !== null) payload.fxRate = fxManual;
  }
  return { payload };
}

export default function PropertyForm({ property, onSaved, onCancel }: Props) {
  const [f, setF] = useState<FormState>(() => initialState(property));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const setPhotoUrls = useCallback(
    (next: string[] | ((prev: string[]) => string[])) =>
      setF((prev) => ({ ...prev, photoUrls: typeof next === 'function' ? next(prev.photoUrls) : next })),
    [],
  );

  const set =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setF((prev) => ({ ...prev, [key]: value }));
    };

  /** Google Maps copia las coordenadas como "-32.9442, -60.6505": se pegan en un campo y se reparten solas. */
  function onLatChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    const m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
    setF((prev) => (m ? { ...prev, lat: m[1], lng: m[2] } : { ...prev, lat: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (uploading) {
      setError('Esperá a que terminen de subir las fotos');
      return;
    }
    const { payload, error: validation } = buildPayload(f, property);
    if (!payload) {
      setError(validation ?? 'Revisá los datos');
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<Property>(property ? `/properties/${property.id}` : '/properties', {
        method: property ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  // Vista previa del precio que se está escribiendo
  const price = validAmount(f.price);
  const fxManual = f.fxRate.trim() === '' ? null : validAmount(f.fxRate);
  let pricePreview = '';
  if (price) {
    if (f.currency === 'USD') {
      pricePreview = formatUsd(price) + (fxManual ? ` ≈ ${formatArs(price * fxManual)}` : '');
    } else {
      pricePreview = formatArs(price) + (fxManual ? ` ≈ ${formatUsd(price / fxManual)}` : '');
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ overflowY: 'auto', padding: 20 }}>
        <h3 style={sectionTitle}>Datos generales</h3>
        <div style={grid}>
          <Field label="Título *" wide>
            <input style={input} value={f.title} onChange={set('title')} autoFocus placeholder="Depto 2 amb. con balcón en Pichincha" />
          </Field>
          <Field label="Tipo *">
            <select style={input} value={f.type} onChange={set('type')}>
              {PROPERTY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Operación *">
            <select style={input} value={f.operation} onChange={set('operation')}>
              {OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select style={input} value={f.status} onChange={set('status')}>
              {STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Descripción" wide>
            <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={f.description} onChange={set('description')} />
          </Field>
        </div>

        <h3 style={sectionTitle}>Precio</h3>
        <div style={grid}>
          <Field label="Moneda en la que cargás el precio">
            <select style={input} value={f.currency} onChange={set('currency')}>
              <option value="USD">Dólares (USD)</option>
              <option value="ARS">Pesos (ARS)</option>
            </select>
          </Field>
          <Field label="Precio *" hint={pricePreview ? `= ${pricePreview}` : 'Podés escribir 98000 o 98.000'}>
            <input style={input} inputMode="decimal" value={f.price} onChange={set('price')} placeholder="98.000" />
          </Field>
          <Field label="Cotización del dólar">
            <select style={input} value={f.fxSource} onChange={set('fxSource')}>
              {FX_SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field
            label="Cotización manual (opcional)"
            hint={
              property
                ? `Guardada: $${property.fxRate} (${property.fxSource}, ${formatShortDate(property.fxRateDate)}). Si no tocás el precio ni la cotización, se mantiene.`
                : 'Si queda vacía se usa la del día al guardar.'
            }
          >
            <input style={input} inputMode="decimal" value={f.fxRate} onChange={set('fxRate')} placeholder="1.400" />
          </Field>
        </div>
        <p style={note}>
          El valor en dólares es el que manda: el precio en pesos se calcula siempre con la cotización elegida.
        </p>

        <h3 style={sectionTitle}>Ubicación</h3>
        <div style={grid}>
          <Field label="Dirección *" wide>
            <input style={input} value={f.address} onChange={set('address')} placeholder="Balcarce 1200" />
          </Field>
          <Field label="Barrio *">
            <input style={input} value={f.neighborhood} onChange={set('neighborhood')} />
          </Field>
          <Field label="Ciudad *">
            <input style={input} value={f.city} onChange={set('city')} />
          </Field>
          <Field label="Provincia *">
            <input style={input} value={f.province} onChange={set('province')} />
          </Field>
          <Field label="Latitud" hint="Opcional. Sirve para buscar por cercanía y mejora la tasación.">
            <input style={input} inputMode="decimal" value={f.lat} onChange={onLatChange} placeholder="-32.9442" />
          </Field>
          <Field label="Longitud" hint="En Google Maps: clic derecho en el punto, copiá las coordenadas y pegalas en Latitud.">
            <input style={input} inputMode="decimal" value={f.lng} onChange={set('lng')} placeholder="-60.6505" />
          </Field>
        </div>

        <h3 style={sectionTitle}>Características</h3>
        <div style={grid}>
          <Field label="m² cubiertos *">
            <input style={input} inputMode="decimal" value={f.coveredM2} onChange={set('coveredM2')} />
          </Field>
          <Field label="m² totales *">
            <input style={input} inputMode="decimal" value={f.totalM2} onChange={set('totalM2')} />
          </Field>
          <Field label="Ambientes">
            <input style={input} inputMode="numeric" value={f.rooms} onChange={set('rooms')} />
          </Field>
          <Field label="Dormitorios">
            <input style={input} inputMode="numeric" value={f.bedrooms} onChange={set('bedrooms')} />
          </Field>
          <Field label="Baños">
            <input style={input} inputMode="numeric" value={f.bathrooms} onChange={set('bathrooms')} />
          </Field>
          <Field label="Cocheras">
            <input style={input} inputMode="numeric" value={f.garageSpots} onChange={set('garageSpots')} />
          </Field>
          <Field label="Antigüedad (años)">
            <input style={input} inputMode="numeric" value={f.ageYears} onChange={set('ageYears')} />
          </Field>
          <Field label="Amenities" hint="Separados por coma" wide>
            <input style={input} value={f.amenities} onChange={set('amenities')} placeholder="pileta, SUM, balcón, parrilla" />
          </Field>
        </div>

        <h3 style={sectionTitle}>Fotos</h3>
        <PhotoManager urls={f.photoUrls} setUrls={setPhotoUrls} onBusyChange={setUploading} />
      </div>

      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" onClick={onCancel} style={btnSecondary} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving || uploading ? 0.7 : 1 }} disabled={saving || uploading}>
          {saving ? 'Guardando…' : uploading ? 'Subiendo fotos…' : property ? 'Guardar cambios' : 'Crear propiedad'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'block', gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: colors.muted, marginTop: 4 }}>{hint}</small>}
    </label>
  );
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 };
const sectionTitle: CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, margin: '22px 0 10px' };
const note: CSSProperties = { fontSize: 13, color: colors.muted, margin: '10px 0 0' };
const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '14px 20px',
  borderTop: `1px solid ${colors.border}`,
};
