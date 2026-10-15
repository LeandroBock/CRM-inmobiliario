import { useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch, apiFetchBlob } from '../api/client';
import { formatUsd, type Property } from '../api/properties';
import { useBrand } from '../brand';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';

/** Mismo tope que la API (MAX_SHEET_PHOTOS): portada + 6 en la segunda hoja. */
const MAX_PHOTOS = 7;

interface Props {
  property: Property;
  onClose: () => void;
}

/** Opciones de la ficha en PDF y descarga. */
export default function PropertySheet({ property, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(property.photoUrls.slice(0, MAX_PHOTOS));
  const [brand, setBrand] = useBrand();
  const [showPrice, setShowPrice] = useState(true);
  const [showArs, setShowArs] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);

  function toggle(url: string) {
    setResult(null);
    setSelected((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : prev.length >= MAX_PHOTOS ? prev : [...prev, url]));
  }

  async function uploadLogo(file: File) {
    try {
      const body = new FormData();
      body.append('files', file);
      const [saved] = await apiFetch<{ url: string }[]>('/media/photos', { method: 'POST', body });
      setBrand((b) => ({ ...b, logoUrl: saved.url }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const blob = await apiFetchBlob(`/properties/${property.id}/sheet`, {
        method: 'POST',
        body: JSON.stringify({
          photoUrls: selected,
          agencyName: brand.agencyName || undefined,
          contact: brand.contact || undefined,
          brandColor: brand.brandColor,
          logoUrl: brand.logoUrl,
          showPrice,
          showArs: showPrice && showArs,
          showAddress,
        }),
      });
      const name = `ficha-${property.title.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-')}.pdf`;
      if (result) URL.revokeObjectURL(result.url);
      const next = { url: URL.createObjectURL(blob), name };
      setResult(next);
      download(next.url, next.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    setResult(null);
    set(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <Field label={`Fotos (${selected.length} de hasta ${MAX_PHOTOS}; la primera va de portada)`}>
          {property.photoUrls.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {property.photoUrls.map((u) => {
                const pos = selected.indexOf(u);
                return (
                  <button key={u} type="button" onClick={() => toggle(u)} style={{ ...thumbBtn, outline: pos >= 0 ? `3px solid ${colors.primary}` : 'none', opacity: pos >= 0 ? 1 : 0.5 }} aria-pressed={pos >= 0} aria-label={pos >= 0 ? `Sacar foto ${pos + 1}` : 'Agregar foto'}>
                    <img src={u} alt="" style={{ width: 72, height: 54, objectFit: 'cover', display: 'block', borderRadius: 6 }} />
                    {pos >= 0 && <span style={badge}>{pos + 1}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <span style={{ fontSize: 14, color: colors.muted }}>La propiedad no tiene fotos: la ficha sale solo con los datos.</span>
          )}
        </Field>

        <Field label="Qué mostrar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={check}>
              <input type="checkbox" checked={showPrice} onChange={(e) => change(setShowPrice)(e.target.checked)} />
              Precio ({formatUsd(property.priceUsd)})
            </label>
            <label style={{ ...check, opacity: showPrice ? 1 : 0.5 }}>
              <input type="checkbox" checked={showArs} disabled={!showPrice} onChange={(e) => change(setShowArs)(e.target.checked)} />
              Referencia en pesos
            </label>
            <label style={check}>
              <input type="checkbox" checked={showAddress} onChange={(e) => change(setShowAddress)(e.target.checked)} />
              Dirección exacta ({property.address}) — si no, solo barrio y ciudad
            </label>
          </div>
        </Field>

        <div style={grid}>
          <Field label="Nombre de la inmobiliaria">
            <input style={input} value={brand.agencyName} onChange={(e) => change(setBrand)({ ...brand, agencyName: e.target.value })} placeholder="Inmobiliaria …" aria-label="Nombre de la inmobiliaria" />
          </Field>
          <Field label="Contacto (abajo de todo)">
            <input style={input} value={brand.contact} onChange={(e) => change(setBrand)({ ...brand, contact: e.target.value })} placeholder="WhatsApp 341 555-0000" aria-label="Contacto" />
          </Field>
          <Field label="Color">
            <input type="color" style={{ ...input, padding: 2, height: 40 }} value={brand.brandColor} onChange={(e) => change(setBrand)({ ...brand, brandColor: e.target.value })} aria-label="Color de la marca" />
          </Field>
          <Field label="Logo">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {brand.logoUrl && <img src={brand.logoUrl} alt="Logo" style={{ height: 36, borderRadius: 4 }} />}
              <label style={{ ...btnSecondary, padding: '6px 10px', display: 'inline-block' }}>
                {brand.logoUrl ? 'Cambiar' : 'Subir logo'}
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              </label>
              {brand.logoUrl && (
                <button type="button" style={btnLink} onClick={() => change(setBrand)({ ...brand, logoUrl: null })}>
                  Quitar
                </button>
              )}
            </div>
          </Field>
        </div>
        <small style={{ color: colors.muted }}>La marca es la misma que la de los reels y queda guardada en este navegador.</small>
      </div>

      <div style={footer}>
        <span role="alert" style={{ color: error ? colors.danger : '#2b8a3e', fontSize: 14, flex: 1 }}>
          {error ?? (result ? 'Listo: se descargó la ficha. Mandala por WhatsApp como documento o imprimila.' : '')}
        </span>
        <button type="button" style={btnLink} onClick={onClose} disabled={busy}>
          Cerrar
        </button>
        <button type="button" style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }} onClick={generate} disabled={busy}>
          {busy ? 'Armando el PDF…' : result ? 'Descargar de nuevo' : 'Descargar PDF'}
        </button>
      </div>
    </div>
  );
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</span>
      {children}
    </div>
  );
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' };
const thumbBtn: CSSProperties = { position: 'relative', border: 0, padding: 0, background: 'none', cursor: 'pointer', borderRadius: 6 };
const badge: CSSProperties = { position: 'absolute', top: 2, left: 2, background: colors.primary, color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 6px' };
const check: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}`, flexWrap: 'wrap' };
