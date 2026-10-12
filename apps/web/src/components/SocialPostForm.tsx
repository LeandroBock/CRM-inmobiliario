import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import { formatUsd, type Paginated, type Property } from '../api/properties';
import {
  INSTAGRAM_MAX_CAPTION,
  MAX_POST_PHOTOS,
  PLATFORMS,
  TIKTOK_PRIVACY,
  captionOf,
  isVideoUrl,
  parseHashtags,
  suggestFromProperty,
  type Platform,
  type SocialPost,
  type TikTokCreatorInfo,
} from '../api/social';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';
import PhotoManager from './PhotoManager';
import VideoUploader from './VideoUploader';

type When = 'borrador' | 'ahora' | 'programar';
type Media = 'fotos' | 'video';

interface Props {
  /** null = nueva publicación; con una publicación = edición. */
  post: SocialPost | null;
  /** Para "Publicar" desde Propiedades: arranca con esa propiedad, su texto sugerido y sus fotos. */
  initialProperty?: Property | null;
  /** Redes listas para publicar (claves cargadas; TikTok, con la cuenta conectada). */
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

const nameOf = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

export default function SocialPostForm({ post, initialProperty = null, configured, onDone, onCancel }: Props) {
  const editing = post !== null;
  const initialVideo = post?.mediaUrls.length === 1 && isVideoUrl(post.mediaUrls[0]) ? post.mediaUrls[0] : null;
  const [media, setMedia] = useState<Media>(initialVideo ? 'video' : 'fotos');
  // Nueva: las redes conectadas que sirven para fotos; si todavía no hay ninguna, Facebook e Instagram
  // (los borradores se pueden preparar igual). TikTok se suma al elegir video.
  const [platforms, setPlatforms] = useState<Platform[]>(() => {
    if (editing) return [post.platform as Platform];
    const connected = PLATFORMS.filter((p) => configured[p.value] && !p.videoOnly).map((p) => p.value);
    return connected.length ? connected : ['facebook', 'instagram'];
  });
  const [properties, setProperties] = useState<Property[]>(initialProperty ? [initialProperty] : []);
  const [propertyId, setPropertyId] = useState<string>(post?.property?.id ?? initialProperty?.id ?? '');
  const [copy, setCopy] = useState(post?.copy ?? '');
  const [hashtagsRaw, setHashtagsRaw] = useState((post?.hashtags ?? []).map((h) => `#${h}`).join(' '));
  const [photos, setPhotos] = useState<string[]>(initialVideo ? [] : (post?.mediaUrls ?? []));
  const [video, setVideo] = useState<string | null>(initialVideo);
  const [when, setWhen] = useState<When>(post?.status === 'programado' ? 'programar' : 'borrador');
  const [scheduledLocal, setScheduledLocal] = useState(toLocalInput(post?.scheduledAt));
  // TikTok: TikTok exige que el usuario elija la privacidad (sin valor por defecto) y mostrar la cuenta
  const [privacy, setPrivacy] = useState(post?.platformOptions?.privacyLevel ?? '');
  const [allowComment, setAllowComment] = useState(!post?.platformOptions?.disableComment);
  const [allowDuet, setAllowDuet] = useState(!post?.platformOptions?.disableDuet);
  const [allowStitch, setAllowStitch] = useState(!post?.platformOptions?.disableStitch);
  const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Paginated<Property>>('/properties?limit=100')
      .then((d) => setProperties((prev) => [...prev.filter((p) => !d.items.some((x) => x.id === p.id)), ...d.items]))
      .catch(() => undefined); // sin la lista igual se puede publicar sin propiedad
  }, []);

  const tiktok = platforms.includes('tiktok');
  useEffect(() => {
    if (!tiktok || creator || !configured.tiktok) return;
    apiFetch<TikTokCreatorInfo>('/social/tiktok/creator-info')
      .then((c) => {
        setCreator(c);
        if (c.commentDisabled) setAllowComment(false);
        if (c.duetDisabled) setAllowDuet(false);
        if (c.stitchDisabled) setAllowStitch(false);
      })
      .catch((e: Error) => setCreatorError(e.message));
  }, [tiktok, creator, configured.tiktok]);

  const property = properties.find((p) => p.id === propertyId) ?? null;

  const fillFromProperty = useCallback(
    (p: Property, overwrite: boolean) => {
      const s = suggestFromProperty(p, formatUsd);
      if (overwrite || !copy.trim()) setCopy(s.copy);
      if (overwrite || !hashtagsRaw.trim()) setHashtagsRaw(s.hashtags.map((h) => `#${h}`).join(' '));
      if (media === 'fotos' && (overwrite || photos.length === 0)) setPhotos(p.photoUrls.slice(0, MAX_POST_PHOTOS));
    },
    [copy, hashtagsRaw, photos.length, media],
  );

  // Desde "Publicar" en Propiedades: arranca completo con los datos de la propiedad
  useEffect(() => {
    if (initialProperty && !editing) fillFromProperty(initialProperty, true);
  }, []);

  function chooseMedia(m: Media) {
    setMedia(m);
    // TikTok solo acepta video: con fotos se saca; al elegir video, se suma si está conectado
    if (m === 'fotos') setPlatforms((prev) => prev.filter((p) => p !== 'tiktok'));
    else if (configured.tiktok && !editing) setPlatforms((prev) => (prev.includes('tiktok') ? prev : [...prev, 'tiktok']));
  }

  const hashtags = parseHashtags(hashtagsRaw);
  const captionLength = captionOf(copy, hashtags).length;
  const instagram = platforms.includes('instagram');
  const limited = instagram || tiktok;
  const tooLong = limited && captionLength > INSTAGRAM_MAX_CAPTION;
  const mediaUrls = media === 'video' ? (video ? [video] : []) : photos;
  const privacyOptions = creator?.privacyLevelOptions ?? Object.keys(TIKTOK_PRIVACY);

  function togglePlatform(p: Platform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!platforms.length) return setError('Elegí al menos una red');
    if (media === 'video' && !video) return setError('Subí el video');
    if (instagram && !mediaUrls.length) return setError('Instagram necesita una foto o un video');
    if (tiktok && media !== 'video') return setError('TikTok solo acepta video');
    if (tiktok && !privacy) return setError('TikTok: elegí quién puede ver la publicación');
    if (!copy.trim() && !mediaUrls.length) return setError('Escribí un texto o agregá una foto');
    if (tooLong) return setError(`El texto con los hashtags no puede pasar de ${INSTAGRAM_MAX_CAPTION} caracteres (límite de Instagram y TikTok)`);
    let scheduledAt: string | null = null;
    if (when === 'programar') {
      const d = new Date(scheduledLocal);
      if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000) return setError('Elegí una fecha y hora futura para programar');
      scheduledAt = d.toISOString();
    }
    const content = {
      copy,
      hashtags,
      mediaUrls,
      propertyId: propertyId || null,
      scheduledAt,
      ...(tiktok ? { platformOptions: { privacyLevel: privacy, disableComment: !allowComment, disableDuet: !allowDuet, disableStitch: !allowStitch } } : {}),
    };

    setSaving(true);
    setError(null);
    try {
      const saved: SocialPost[] = editing
        ? [await apiFetch<SocialPost>(`/social/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify(content) })]
        : await apiFetch<SocialPost[]>('/social/posts', { method: 'POST', body: JSON.stringify({ platforms, ...content }) });

      if (when !== 'ahora') {
        const n = saved.length;
        onDone(
          when === 'programar'
            ? `${n === 1 ? 'Quedó programada' : `Quedaron ${n} programadas`} para el ${new Date(scheduledAt!).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`
            : `${n === 1 ? 'Se guardó el borrador' : `Se guardaron ${n} borradores`}`,
        );
        return;
      }
      // Publicar ya, red por red: si una falla, las otras igual salen. Un video puede quedar "publicando" un rato.
      const results = await Promise.all(
        saved.map((p) =>
          apiFetch<SocialPost>(`/social/posts/${p.id}/publish`, { method: 'POST' }).catch((err: Error) => ({ ...p, status: 'fallido' as const, errorMessage: err.message })),
        ),
      );
      const ok = results.filter((r) => r.status === 'publicado').map((r) => nameOf(r.platform));
      const pending = results.filter((r) => r.status === 'publicando').map((r) => nameOf(r.platform));
      const failed = results.filter((r) => r.status === 'fallido');
      const parts = [
        ok.length ? `Publicado en ${ok.join(' y ')}.` : '',
        pending.length ? `${pending.join(' y ')}: procesando el video, en unos minutos queda publicado (se ve en la lista).` : '',
        failed.length ? `No se pudo publicar en ${failed.map((f) => `${nameOf(f.platform)} (${f.errorMessage ?? 'error'})`).join(', ')}; quedó en la lista para corregir y reintentar.` : '',
      ];
      onDone(parts.filter(Boolean).join(' '));
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
            Las redes todavía no están conectadas al CRM. Podés preparar borradores; para publicar falta conectarlas (ver pestaña Redes).
          </p>
        )}

        <Field label="¿Fotos o video?">
          <div style={{ display: 'flex', gap: 16 }}>
            {(['fotos', 'video'] as Media[]).map((m) => (
              <label key={m} style={radioLabel}>
                <input type="radio" name="media" checked={media === m} onChange={() => chooseMedia(m)} disabled={editing && m !== media} />
                {m === 'fotos' ? 'Fotos (hasta 10)' : 'Un video (Reel / TikTok)'}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Redes">
          {editing ? (
            <span style={{ fontSize: 14 }}>{nameOf(post.platform)}</span>
          ) : (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {PLATFORMS.map((p) => {
                const blocked = p.videoOnly && media !== 'video';
                return (
                  <label key={p.value} style={{ ...radioLabel, opacity: blocked ? 0.5 : 1 }} title={blocked ? 'TikTok solo acepta video' : undefined}>
                    <input type="checkbox" checked={platforms.includes(p.value)} onChange={() => togglePlatform(p.value)} disabled={blocked} />
                    {p.label}
                    {!configured[p.value] && <small style={{ color: colors.muted }}>(sin conectar)</small>}
                    {blocked && <small style={{ color: colors.muted }}>(solo video)</small>}
                  </label>
                );
              })}
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

        <Field label="Texto" hint={limited ? `${captionLength}/${INSTAGRAM_MAX_CAPTION} caracteres con los hashtags` : undefined} error={tooLong}>
          <textarea style={{ ...input, minHeight: 150, resize: 'vertical', lineHeight: 1.45 }} value={copy} onChange={(e) => setCopy(e.target.value)} placeholder="¿Qué querés contar?" />
        </Field>

        <Field label="Hashtags" hint={`Separados por espacios. ${hashtags.length ? `Quedan: ${hashtags.map((h) => `#${h}`).join(' ')}` : ''}`}>
          <input style={input} value={hashtagsRaw} onChange={(e) => setHashtagsRaw(e.target.value)} placeholder="#Rosario #departamento #venta" />
        </Field>

        {media === 'fotos' ? (
          <Field label="Fotos">
            <PhotoManager urls={photos} setUrls={setPhotos} onBusyChange={setUploading} max={MAX_POST_PHOTOS} footnote="Con más de una se publica como carrusel; la primera es la que se ve primero." />
          </Field>
        ) : (
          <Field label="Video">
            <VideoUploader url={video} setUrl={setVideo} onBusyChange={setUploading} />
          </Field>
        )}

        {tiktok && (
          <div style={tiktokBox}>
            <strong style={{ fontSize: 14 }}>TikTok</strong>
            {creator ? (
              <p style={{ margin: '6px 0 10px', fontSize: 14 }}>
                Se publica en <strong>@{creator.creatorUsername}</strong> ({creator.creatorNickname}).
              </p>
            ) : (
              <p style={{ margin: '6px 0 10px', fontSize: 13, color: colors.muted }}>
                {configured.tiktok ? (creatorError ?? 'Consultando la cuenta de TikTok…') : 'La cuenta de TikTok todavía no está conectada: podés dejarlo como borrador.'}
              </p>
            )}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>¿Quién puede verlo?</label>
            <select style={{ ...input, maxWidth: 320 }} value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
              <option value="">Elegí una opción</option>
              {privacyOptions.map((o) => (
                <option key={o} value={o}>
                  {TIKTOK_PRIVACY[o] ?? o}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
              <label style={radioLabel}>
                <input type="checkbox" checked={allowComment} onChange={(e) => setAllowComment(e.target.checked)} disabled={creator?.commentDisabled} />
                Permitir comentarios
              </label>
              <label style={radioLabel}>
                <input type="checkbox" checked={allowDuet} onChange={(e) => setAllowDuet(e.target.checked)} disabled={creator?.duetDisabled} />
                Permitir dúos
              </label>
              <label style={radioLabel}>
                <input type="checkbox" checked={allowStitch} onChange={(e) => setAllowStitch(e.target.checked)} disabled={creator?.stitchDisabled} />
                Permitir stitch
              </label>
            </div>
            <small style={{ display: 'block', color: colors.muted, marginTop: 10 }}>
              Al publicar, aceptás la Política de Contenido Musical de TikTok. Mientras TikTok no apruebe (audite) la app, solo se puede publicar en cuentas privadas.
              {creator?.maxVideoPostDurationSec ? ` Duración máxima para esta cuenta: ${Math.floor(creator.maxVideoPostDurationSec / 60)} min.` : ''}
            </small>
          </div>
        )}

        <Field label="¿Cuándo?">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {(
              [
                ['borrador', 'Guardar como borrador'],
                ['ahora', 'Publicar ahora'],
                ['programar', 'Programar'],
              ] as [When, string][]
            ).map(([value, label]) => (
              <label key={value} style={radioLabel}>
                <input type="radio" name="when" checked={when === value} onChange={() => setWhen(value)} disabled={value === 'ahora' && !platforms.every((p) => configured[p])} />
                {label}
              </label>
            ))}
            {when === 'programar' && <input type="datetime-local" style={{ ...input, width: 220 }} value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />}
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
          {uploading ? 'Subiendo…' : saving ? (when === 'ahora' ? 'Publicando…' : 'Guardando…') : when === 'ahora' ? 'Publicar' : when === 'programar' ? 'Programar' : 'Guardar'}
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

const radioLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
const tiktokBox: CSSProperties = { border: `1px solid ${colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16, background: '#fafbfd' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
