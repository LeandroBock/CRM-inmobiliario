import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch, uploadWithProgress } from '../api/client';
import { OPERATIONS, formatUsd, labelOf, type Property } from '../api/properties';
import { HEIGHT, WIDTH, canRenderMp4, drawFrame, loadImages, renderReel, totalDuration, type LoadedImages, type ReelSpec } from '../reel/reel';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';

/** La marca (logo, nombre, contacto, color) se recuerda en este navegador para no cargarla cada vez. */
const BRAND_KEY = 'crm_reel_brand';
interface Brand {
  agencyName: string;
  contact: string;
  logoUrl: string | null;
  brandColor: string;
}
function loadBrand(): Brand {
  try {
    const b = JSON.parse(localStorage.getItem(BRAND_KEY) ?? '{}');
    return { agencyName: b.agencyName ?? '', contact: b.contact ?? 'Escribinos por WhatsApp', logoUrl: b.logoUrl ?? null, brandColor: b.brandColor ?? '#2f5bea' };
  } catch {
    return { agencyName: '', contact: 'Escribinos por WhatsApp', logoUrl: null, brandColor: '#2f5bea' };
  }
}

/** Textos sugeridos para cada foto, con los datos de la propiedad (editables). */
function suggestCaptions(p: Property, count: number): string[] {
  const facts = [
    `📍 ${p.neighborhood}, ${p.city}`,
    [p.rooms ? `${p.rooms} ambientes` : null, `${p.coveredM2} m² cubiertos`].filter(Boolean).join(' · '),
    p.amenities?.length ? `✨ ${p.amenities.slice(0, 3).join(' · ')}` : p.garageSpots > 0 ? '🚗 Con cochera' : '',
    p.bathrooms ? `${p.bathrooms} baño${p.bathrooms > 1 ? 's' : ''}${p.garageSpots > 0 ? ' · cochera' : ''}` : '',
  ].filter(Boolean);
  return Array.from({ length: count }, (_, i) => facts[i] ?? '');
}

interface Props {
  property: Property;
  /** Con el video ya subido al CRM: abrir una publicación con él. */
  onUse: (videoUrl: string) => void;
  onCancel: () => void;
}

export default function ReelBuilder({ property, onUse, onCancel }: Props) {
  const photosAvailable = property.photoUrls;
  const [selected, setSelected] = useState<string[]>(photosAvailable.slice(0, 6));
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    const s = suggestCaptions(property, 6);
    return Object.fromEntries(photosAvailable.slice(0, 6).map((u, i) => [u, s[i] ?? '']));
  });
  const [seconds, setSeconds] = useState(3);
  const [fit, setFit] = useState<ReelSpec['fit']>('completa');
  const [kicker, setKicker] = useState(property.operation === 'alquiler' ? 'EN ALQUILER' : 'EN VENTA');
  const [title, setTitle] = useState(property.title);
  const [showPrice, setShowPrice] = useState(true);
  const [brand, setBrand] = useState<Brand>(loadBrand);
  const [music, setMusic] = useState<File | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    canRenderMp4().then(setSupported);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    } catch {
      /* sin storage: se vuelve a cargar la próxima vez */
    }
  }, [brand]);

  const spec: ReelSpec = useMemo(
    () => ({
      slides: selected.map((u) => ({ imageUrl: u, caption: captions[u] ?? '' })),
      secondsPerSlide: seconds,
      fit,
      kicker,
      title,
      priceTag: showPrice ? formatUsd(property.priceUsd) : '',
      agencyName: brand.agencyName,
      contact: brand.contact,
      logoUrl: brand.logoUrl,
      brandColor: brand.brandColor,
    }),
    [selected, captions, seconds, fit, kicker, title, showPrice, property.priceUsd, brand],
  );

  // Vista previa en vivo: la misma función que dibuja el video, en un canvas chico que se repite
  const [images, setImages] = useState<LoadedImages | null>(null);
  useEffect(() => {
    let cancelled = false;
    setImages(null);
    if (!selected.length) return;
    loadImages(spec)
      .then((imgs) => !cancelled && setImages(imgs))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // Solo cuando cambian las imágenes (no con cada letra de un texto)
  }, [selected.join('|'), brand.logoUrl]);

  useEffect(() => {
    if (!images || !preview.current) return;
    const ctx = preview.current.getContext('2d')!;
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      const t = ((performance.now() - start) / 1000) % totalDuration(spec);
      drawFrame(ctx, spec, images, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [images, spec]);

  function toggle(url: string) {
    setResult(null);
    setSelected((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : prev.length >= 10 ? prev : [...prev, url]));
    setCaptions((prev) => (url in prev ? prev : { ...prev, [url]: '' }));
  }
  const move = (i: number, d: number) =>
    setSelected((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

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
    if (selected.length < 2) return setError('Elegí al menos 2 fotos');
    setError(null);
    setResult(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const blob = await renderReel(spec, music, setProgress, abort.current.signal);
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  async function use() {
    if (!result) return;
    setUploadProgress(0);
    setError(null);
    try {
      const file = new File([result.blob], `reel-${property.title.slice(0, 30)}.mp4`, { type: 'video/mp4' });
      const saved = await uploadWithProgress<{ url: string }>('/media/videos', file, 'file', setUploadProgress);
      onUse(saved.url);
    } catch (e) {
      setError((e as Error).message);
      setUploadProgress(null);
    }
  }

  const duration = totalDuration(spec);
  const busy = progress !== null || uploadProgress !== null;

  if (supported === false) {
    return (
      <div style={{ padding: 20 }}>
        <p>Este navegador no puede generar videos MP4. Usá <strong>Chrome</strong> o <strong>Edge</strong> actualizados en una computadora.</p>
        <button style={btnSecondary} onClick={onCancel}>Cerrar</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          {result ? (
            <video src={result.url} controls autoPlay style={previewBox} />
          ) : (
            <canvas ref={preview} width={WIDTH} height={HEIGHT} style={previewBox} aria-label="Vista previa del reel" />
          )}
          <small style={{ display: 'block', color: colors.muted, marginTop: 6, textAlign: 'center' }}>
            {Math.round(duration)} s · 1080×1920 (vertical)
          </small>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          {!photosAvailable.length && <p style={{ color: colors.danger }}>La propiedad no tiene fotos: cargale fotos para armar el reel.</p>}
          <Field label={`Fotos (${selected.length} elegidas, de 2 a 10, en este orden)`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {photosAvailable.map((u) => {
                const pos = selected.indexOf(u);
                return (
                  <button key={u} type="button" onClick={() => toggle(u)} style={{ ...thumbBtn, outline: pos >= 0 ? `3px solid ${colors.primary}` : 'none', opacity: pos >= 0 ? 1 : 0.55 }} title={pos >= 0 ? 'Sacar' : 'Agregar'}>
                    <img src={u} alt="" style={{ width: 64, height: 64, objectFit: 'cover', display: 'block', borderRadius: 6 }} />
                    {pos >= 0 && <span style={badge}>{pos + 1}</span>}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Texto de cada foto">
            {selected.map((u, i) => (
              <div key={u} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <img src={u} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                <input style={{ ...input, padding: '6px 9px', fontSize: 14 }} value={captions[u] ?? ''} onChange={(e) => setCaptions((c) => ({ ...c, [u]: e.target.value }))} placeholder="(sin texto)" aria-label={`Texto de la foto ${i + 1}`} />
                <button type="button" style={miniBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
                <button type="button" style={miniBtn} onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label="Bajar">↓</button>
              </div>
            ))}
          </Field>

          <div style={grid}>
            <Field label="Portada: arriba">
              <input style={input} value={kicker} onChange={(e) => setKicker(e.target.value)} aria-label="Portada: arriba" />
            </Field>
            <Field label="Portada: título">
              <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Portada: título" />
            </Field>
            <Field label="Segundos por foto">
              <select style={input} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Segundos por foto">
                {[2.5, 3, 4, 5].map((s) => <option key={s} value={s}>{String(s).replace('.', ',')} s</option>)}
              </select>
            </Field>
            <Field label="Encuadre">
              <select style={input} value={fit} onChange={(e) => setFit(e.target.value as ReelSpec['fit'])} aria-label="Encuadre">
                <option value="completa">Foto completa (fondo difuminado)</option>
                <option value="llenar">Llenar la pantalla (recorta los costados)</option>
              </select>
            </Field>
            <Field label="Precio">
              <label style={check}>
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                Mostrar {formatUsd(property.priceUsd)} ({labelOf(OPERATIONS, property.operation).toLowerCase()})
              </label>
            </Field>
          </div>

          <div style={grid}>
            <Field label="Cierre: nombre de la inmobiliaria">
              <input style={input} value={brand.agencyName} onChange={(e) => setBrand((b) => ({ ...b, agencyName: e.target.value }))} placeholder="Inmobiliaria …" aria-label="Cierre: nombre de la inmobiliaria" />
            </Field>
            <Field label="Cierre: contacto">
              <input style={input} value={brand.contact} onChange={(e) => setBrand((b) => ({ ...b, contact: e.target.value }))} placeholder="WhatsApp 341 555-0000" aria-label="Cierre: contacto" />
            </Field>
            <Field label="Color de la marca">
              <input type="color" style={{ ...input, padding: 2, height: 40 }} value={brand.brandColor} onChange={(e) => setBrand((b) => ({ ...b, brandColor: e.target.value }))} aria-label="Color de la marca" />
            </Field>
            <Field label="Logo">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {brand.logoUrl && <img src={brand.logoUrl} alt="Logo" style={{ height: 36, borderRadius: 4 }} />}
                <label style={{ ...btnSecondary, padding: '6px 10px', display: 'inline-block' }}>
                  {brand.logoUrl ? 'Cambiar' : 'Subir logo'}
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
                {brand.logoUrl && <button type="button" style={btnLink} onClick={() => setBrand((b) => ({ ...b, logoUrl: null }))}>Quitar</button>}
              </div>
            </Field>
          </div>

          <Field label="Música (opcional)" hint="Un MP3 o M4A tuyo o con licencia libre. Las redes pueden silenciar videos con música con derechos de autor.">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ ...btnSecondary, padding: '6px 10px', display: 'inline-block' }}>
                {music ? 'Cambiar' : 'Elegir música'}
                <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && (setMusic(e.target.files[0]), setResult(null))} />
              </label>
              {music && (
                <>
                  <span style={{ fontSize: 13 }}>{music.name}</span>
                  <button type="button" style={btnLink} onClick={() => (setMusic(null), setResult(null))}>Quitar</button>
                </>
              )}
            </div>
          </Field>
        </div>
      </div>

      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error ??
            (progress !== null
              ? `Generando el video… ${Math.round(progress * 100)}%`
              : uploadProgress !== null
                ? `Subiendo… ${Math.round(uploadProgress * 100)}%`
                : '')}
        </span>
        {progress !== null ? (
          <button style={btnLink} onClick={() => abort.current?.abort()}>Cancelar</button>
        ) : (
          <button style={btnLink} onClick={onCancel} disabled={busy}>Cerrar</button>
        )}
        {result && (
          <a href={result.url} download={`reel-${property.title.slice(0, 30)}.mp4`} style={{ ...btnSecondary, textDecoration: 'none' }}>
            Descargar
          </a>
        )}
        {result ? (
          <button style={btnPrimary} onClick={use} disabled={busy}>Usar en una publicación</button>
        ) : (
          <button style={{ ...btnPrimary, opacity: busy || supported === null ? 0.7 : 1 }} onClick={generate} disabled={busy || supported === null || selected.length < 2}>
            Generar video
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: colors.muted, marginTop: 4 }}>{hint}</small>}
    </div>
  );
}

const previewBox: CSSProperties = { width: 240, height: 427, borderRadius: 12, background: '#000', display: 'block' };
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' };
const thumbBtn: CSSProperties = { position: 'relative', border: 0, padding: 0, background: 'none', cursor: 'pointer', borderRadius: 6 };
const badge: CSSProperties = { position: 'absolute', top: 2, left: 2, background: colors.primary, color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '1px 6px' };
const miniBtn: CSSProperties = { border: `1px solid ${colors.border}`, background: '#fff', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' };
const check: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
