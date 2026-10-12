import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import {
  OPERATIONS,
  PROPERTY_TYPES,
  STATUSES,
  formatUsd,
  labelOf,
  parseAmount,
  type ComparablesRequest,
  type ComparablesResult,
  type Property,
} from '../api/properties';
import { btnPrimary, btnSecondary, colors, input } from '../styles';

const CONFIDENCE: Record<string, { label: string; bg: string; fg: string; help: string }> = {
  alta: { label: 'Confianza alta', bg: '#d3f9d8', fg: '#2b8a3e', help: 'Muchas comparables con precios parecidos.' },
  media: { label: 'Confianza media', bg: '#fff3bf', fg: '#e67700', help: 'Algunas comparables, o precios algo dispersos.' },
  baja: { label: 'Confianza baja', bg: '#ffe3e3', fg: '#c92a2a', help: 'Pocas comparables o precios muy distintos: es solo una referencia.' },
};

const distance = (m: number | null) => (m === null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/**
 * Tasación por comparables. Con `property` tasa esa propiedad (con sus datos); sin ella, muestra un formulario
 * para tasar algo que todavía no está cargado.
 */
export default function Appraisal({ property, onClose }: { property: Property | null; onClose: () => void }) {
  const [result, setResult] = useState<ComparablesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(property === null);

  async function run(body: ComparablesRequest) {
    setLoading(true);
    setError(null);
    try {
      setResult(await apiFetch<ComparablesResult>('/avo/comparables', { method: 'POST', body: JSON.stringify(body) }));
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (property) void run({ propertyId: property.id });
  }, [property?.id]);

  return (
    <>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        {property && (
          <p style={{ margin: '0 0 14px', fontSize: 14, color: colors.muted }}>
            <strong style={{ color: '#1f2937' }}>{property.title}</strong> · {labelOf(PROPERTY_TYPES, property.type)} en{' '}
            {labelOf(OPERATIONS, property.operation).toLowerCase()} · {property.coveredM2} m² cubiertos · {property.neighborhood}
            {!property.location && ' · sin ubicación en el mapa (se busca por barrio)'}
          </p>
        )}
        {showForm && <AppraisalForm loading={loading} onSubmit={run} />}
        {loading && !showForm && <p style={{ color: colors.muted }}>Buscando comparables…</p>}
        {error && (
          <p role="alert" style={{ ...banner, background: '#fff5f5', borderColor: '#ffc9c9', color: colors.danger }}>
            {error}
          </p>
        )}
        {result && !showForm && <AppraisalResult result={result} />}
      </div>
      <div style={footer}>
        <small style={{ color: colors.muted, flex: 1 }}>
          Tasación por comparables: precios de publicación de propiedades parecidas cargadas en el CRM.
        </small>
        {result && !showForm && !property && (
          <button style={btnSecondary} onClick={() => setShowForm(true)}>
            Tasar otra
          </button>
        )}
        <button style={btnPrimary} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </>
  );
}

function AppraisalResult({ result }: { result: ComparablesResult }) {
  const e = result.estimate;
  const c = e ? CONFIDENCE[e.confidence] : null;
  return (
    <div>
      {e && c ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: colors.muted }}>Valor estimado</div>
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2 }}>{formatUsd(e.estimatedPriceUsd)}</div>
            <div style={{ fontSize: 14, color: colors.muted }}>
              entre {formatUsd(e.rangeLowUsd)} y {formatUsd(e.rangeHighUsd)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: colors.muted }}>USD/m²</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatUsd(e.pricePerM2Usd)}</div>
          </div>
          <span title={c.help} style={{ background: c.bg, color: c.fg, borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 600 }}>
            {c.label}
          </span>
        </div>
      ) : (
        <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 10px' }}>No hay suficientes comparables para estimar un valor.</p>
      )}

      {result.warning && <p style={{ ...banner, background: '#fff9db', borderColor: '#ffec99' }}>{result.warning}</p>}
      <p style={{ fontSize: 13, color: colors.muted, margin: '0 0 10px' }}>Se usaron: {result.criteria}.</p>

      {result.comparables.length > 0 && (
        <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted }}>
                <th style={th}>Comparable</th>
                <th style={th}>m²</th>
                <th style={th}>Precio</th>
                <th style={th}>USD/m²</th>
                <th style={th}>Distancia</th>
                <th style={th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {result.comparables.map((p) => (
                <tr
                  key={p.id}
                  style={{ borderTop: `1px solid ${colors.border}`, opacity: p.outlier ? 0.5 : 1 }}
                  title={p.outlier ? 'No se usó: su precio está muy lejos del resto' : undefined}
                >
                  <td style={td}>
                    {p.title}
                    <br />
                    <small style={{ color: colors.muted }}>
                      {p.neighborhood}
                      {p.outlier && ' · descartada (precio fuera de lo normal)'}
                    </small>
                  </td>
                  <td style={td}>{p.coveredM2}</td>
                  <td style={td}>{formatUsd(p.priceUsd)}</td>
                  <td style={td}>{formatUsd(p.pricePerM2Usd)}</td>
                  <td style={td}>{distance(p.distanceM)}</td>
                  <td style={td}>{labelOf(STATUSES, p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AppraisalForm({ loading, onSubmit }: { loading: boolean; onSubmit: (body: ComparablesRequest) => void }) {
  const [type, setType] = useState('departamento');
  const [operation, setOperation] = useState('venta');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const coveredM2 = parseAmount(area);
    if (coveredM2 === null || Number.isNaN(coveredM2) || coveredM2 <= 0) return setProblem('Indicá la superficie cubierta en m²');
    const la = lat.trim() ? Number(lat.replace(',', '.')) : undefined;
    const ln = lng.trim() ? Number(lng.replace(',', '.')) : undefined;
    if ((la === undefined) !== (ln === undefined) || Number.isNaN(la) || Number.isNaN(ln)) return setProblem('Latitud y longitud van juntas (o ninguna)');
    if (la === undefined && !neighborhood.trim()) return setProblem('Indicá el barrio o la ubicación (latitud y longitud)');
    setProblem(null);
    onSubmit({ type, operation, coveredM2, neighborhood: neighborhood.trim() || undefined, city: city.trim() || undefined, lat: la, lng: ln });
  }

  return (
    <form onSubmit={submit} noValidate>
      <div style={grid}>
        <Field label="Tipo">
          <select style={input} value={type} onChange={(e) => setType(e.target.value)}>
            {PROPERTY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Operación">
          <select style={input} value={operation} onChange={(e) => setOperation(e.target.value)}>
            {OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Superficie cubierta (m²)">
          <input style={input} inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej.: 55" autoFocus />
        </Field>
        <Field label="Barrio">
          <input style={input} value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Ej.: Centro" />
        </Field>
        <Field label="Ciudad" hint="Si en el barrio hay pocas comparables, se busca en la ciudad.">
          <input style={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ej.: Rosario" />
        </Field>
        <Field label="Latitud y longitud (opcional)" hint="Con la ubicación se buscan las más cercanas. Se copian de Google Maps (clic derecho en el mapa).">
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={input} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-32,9477" aria-label="Latitud" />
            <input style={input} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-60,6304" aria-label="Longitud" />
          </div>
        </Field>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>{problem}</span>
        <button type="submit" style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }} disabled={loading}>
          {loading ? 'Tasando…' : 'Tasar'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: colors.muted, marginTop: 4 }}>{hint}</small>}
    </label>
  );
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 };
const th: CSSProperties = { padding: '8px 10px', fontWeight: 500 };
const td: CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 12px' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
