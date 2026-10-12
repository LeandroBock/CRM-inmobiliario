import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import { formatUsd, type Paginated, type Property } from '../api/properties';
import {
  INSTAGRAM_MAX_CAPTION,
  MAX_POST_PHOTOS,
  PLATFORMS,
  captionOf,
  parseHashtags,
  suggestFromProperty,
  type Platform,
  type SocialPost,
} from '../api/social';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';
import PhotoManager from './PhotoManager';

type When = 'borrador' | 'ahora' | 'programar';

interface Props {
  /** null = nueva publicación; con una publicación = edición. */
  post: SocialPost | null;
  /** Para "Publicar" desde Propiedades: arranca con esa propiedad, su texto sugerido y sus fotos. */
  initialProperty?: Property | null;
  /** Redes con las claves de Meta cargadas en el servidor. */
  configured: Record<string, boolean>;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** "2026-10-14T18:30" (hora local del navegador) para un input datetime-local. */
function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SocialPostForm({ post, initialProperty = null, configured, onDone, onCancel }: Props) {
  const editing = post !== null;
  // Nueva: las redes conectadas; si todavía no hay ninguna, las dos (los borradores se pueden preparar igual).
  const [platforms, setPlatforms] = useState<Platform[]>(() => {
    if (editing) return [post.platform as Platform];
    const connected = PLATFORMS.filter((p) => configured[p.value]).map((p) => p.value);
    return connected.length ? connected : PLATFORMS.map((p) => p.value);
  });
  const [properties, setProperties] = useState<Property[]>(initialProperty ? [initialProperty] : []);
  const [propertyId, setPropertyId] = useState<string>(post?.property?.id ?? initialProperty?.id ?? '');
  const [copy, setCopy] = useState(post?.copy ?? '');
  const [hashtagsRaw, setHashtagsRaw] = useState((post?.hashtags ?? []).map((h) => `#${h}`).join(' '));
  const [photos, setPhotos] = useState<string[]>(post?.mediaUrls ?? []);
  const [when, setWhen] = useState<When>(post?.status === 'programado' ? 'programar' : 'borrador');
  const [scheduledLocal, setScheduledLocal] = useState(toLocalInput(post?.scheduledAt));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Paginated<Property>>('/properties?limit=100')
      .then((d) => setProperties((prev) => [...prev.filter((p) => !d.items.some((x) => x.id === p.id)), ...d.items]))
      .catch(() => undefined); // sin la lista igual se puede publicar sin propiedad
  }, []);

  const property = properties.find((p) => p.id === propertyId) ?? null;

  const fillFromProperty = useCallback(
    (p: Property, overwrite: boolean) => {
      const s = suggestFromProperty(p, formatUsd);
      if (overwrite || !copy.trim()) setCopy(s.copy);
      if (overwrite || !hashtagsRaw.trim()) setHashtagsRaw(s.hashtags.map((h) => `#${h}`).join(' '));
      if (overwrite || photos.length === 0) setPhotos(p.photoUrls.slice(0, MAX_POST_PHOTOS));
    },
    [copy, hashtagsRaw, photos.length],
  );

  // Desde "Publicar" en Propiedades: arranca completo con los datos de la propiedad
  useEffect(() => {
    if (initialProperty && !editing) fillFromProperty(initialProperty, true);
  }, []);

  const hashtags = parseHashtags(hashtagsRaw);
  const captionLength = captionOf(copy, hashtags).length;
  const instagram = platforms.includes('instagram');
  const tooLong = instagram && captionLength > INSTAGRAM_MAX_CAPTION;

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!platforms.length) return setError('Elegí al menos una red');
    if (instagram && photos.length === 0) return setError('Instagram necesita al menos una foto');
    if (!copy.trim() && photos.length === 0) return setError('Escribí un texto o agregá una foto');
    if (tooLong) return setError(`Para Instagram, el texto con los hashtags no puede pasar de ${INSTAGRAM_MAX_CAPTION} caracteres`);
    let scheduledAt: string | null = null;
    if (when === 'programar') {
      const d = new Date(scheduledLocal);
      if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000) return setError('Elegí una fecha y hora futura para programar');
      scheduledAt = d.toISOString();
    }
    const content = { copy, hashtags, mediaUrls: photos, propertyId: propertyId || null, scheduledAt };

    setSaving(true);
    setError(null);
    try {
      const saved: SocialPost[] = editing
        ? [await apiFetch<SocialPost>(`/social/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify(content) })]
        : await apiFetch<SocialPost[]>('/social/posts', { method: 'POST', body: JSON.stringify({ platforms, ...content }) });

      if (when !== 'ahora') {
        const n = saved.length;
        onDone(when === 'programar' ? `${n === 1 ? 'Quedó programada' : `Quedaron ${n} programadas`} para el ${new Date(scheduledAt!).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : `${n === 1 ? 'Se guardó el borrador' : `Se guardaron ${n} borradores`}`);
        return;
      }
      // Publicar ya, red por red: si una falla, la otra igual sale
      const results = await Promise.all(
        saved.map((p) => apiFetch<SocialPost>(`/social/posts/${p.id}/publish`, { method: 'POST' }).catch((err: Error) => ({ ...p, status: 'fallido' as const, errorMessage: err.message }))),
      );
      const failed = results.filter((r) => r.status !== 'publicado');
      const name = (p: SocialPost) => PLATFORMS.find((x) => x.value === p.platform)?.label ?? p.platform;
      if (!failed.length) onDone(`Publicado en ${results.map(name).join(' y ')}`);
      else onDone(`No se pudo publicar en ${failed.map((f) => `${name(f)} (${f.errorMessage ?? 'error'})`).join(', ')}. Quedó en la lista para corregir y reintentar.`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const noneConfigured = !PLATFORMS.some((p) => configured[p.value]);

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        {noneConfigured && (
          <p style={{ ...banner, background: '#fff9db', borderColor: '#ffec99' }}>
            Facebook e Instagram todavía no están conectados al CRM. Podés preparar borradores; para publicar falta cargar las claves de Meta en el servidor.
          </p>
        )}

        <Field label="Redes">
          {editing ? (
            <span style={{ fontSize: 14 }}>{PLATFORMS.find((p) => p.value === post.platform)?.label ?? post.platform}</span>
          ) : (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {PLATFORMS.map((p) => (
                <label key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input type="checkbox" checked={platforms.includes(p.value)} onChange={() => togglePlatform(p.value)} />
                  {p.label}
                  {!configured[p.value] && <small style={{ color: colors.muted }}>(sin conectar)</small>}
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field label="Propiedad (opcional)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...input, flex: 1, minWidth: 220 }} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Sin propiedad</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.neighborhood}
                </option>
              ))}
            </select>
            {property && (
              <button type="button" style={btnSecondary} onClick={() => fillFromProperty(property, true)} title="Reemplaza el texto, los hashtags y las fotos con los de la propiedad">
                Completar con la propiedad
              </button>
            )}
          </div>
        </Field>

        <Field label="Texto" hint={instagram ? `${captionLength}/${INSTAGRAM_MAX_CAPTION} caracteres con los hashtags (límite de Instagram)` : undefined} error={tooLong}>
          <textarea style={{ ...input, minHeight: 150, resize: 'vertical', lineHeight: 1.45 }} value={copy} onChange={(e) => setCopy(e.target.value)} placeholder="¿Qué querés contar?" />
        </Field>

        <Field label="Hashtags" hint={`Separados por espacios. ${hashtags.length ? `Quedan: ${hashtags.map((h) => `#${h}`).join(' ')}` : ''}`}>
          <input style={input} value={hashtagsRaw} onChange={(e) => setHashtagsRaw(e.target.value)} placeholder="#Rosario #departamento #venta" />
        </Field>

        <Field label="Fotos">
          <PhotoManager urls={photos} setUrls={setPhotos} onBusyChange={setUploading} max={MAX_POST_PHOTOS} footnote="Con más de una se publica como carrusel; la primera es la que se ve primero." />
        </Field>

        <Field label="¿Cuándo?">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {(
              [
                ['borrador', 'Guardar como borrador'],
                ['ahora', 'Publicar ahora'],
                ['programar', 'Programar'],
              ] as [When, string][]
            ).map(([value, label]) => (
              <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input type="radio" name="when" checked={when === value} onChange={() => setWhen(value)} disabled={value === 'ahora' && !platforms.every((p) => configured[p])} />
                {label}
              </label>
            ))}
            {when === 'programar' && (
              <input type="datetime-local" style={{ ...input, width: 220 }} value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
            )}
          </div>
        </Field>
      </div>

      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnLink} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving || uploading ? 0.7 : 1 }} disabled={saving || uploading}>
          {uploading ? 'Subiendo fotos…' : saving ? (when === 'ahora' ? 'Publicando…' : 'Guardando…') : when === 'ahora' ? 'Publicar' : when === 'programar' ? 'Programar' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: error ? colors.danger : colors.muted, marginTop: 4 }}>{hint}</small>}
    </div>
  );
}

const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
