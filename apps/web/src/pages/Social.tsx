import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import type { Paginated } from '../api/properties';
import { PLATFORMS, POST_STATUSES, captionOf, type SocialPost } from '../api/social';
import Modal from '../components/Modal';
import SocialPostForm from '../components/SocialPostForm';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';

const LIMIT = 15;
const EDITABLE = ['borrador', 'programado', 'fallido'];

const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Publicaciones en Facebook e Instagram: borradores, programadas, publicadas y las que fallaron. */
export default function Social() {
  const [data, setData] = useState<Paginated<SocialPost> | null>(null);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<SocialPost | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Record<string, boolean>>('/social/status').then(setConfigured).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set('status', status);
    if (platform) params.set('platform', platform);
    apiFetch<Paginated<SocialPost>>(`/social/posts?${params.toString()}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [page, status, platform, reload]);

  async function act(post: SocialPost, action: 'publish' | 'delete') {
    if (action === 'delete') {
      const msg = post.status === 'publicado' ? 'Se borra del CRM, pero en la red sigue publicada (borrala desde Facebook o Instagram). ¿Seguir?' : '¿Eliminar esta publicación?';
      if (!window.confirm(msg)) return;
    }
    setBusy(post.id);
    setError(null);
    try {
      if (action === 'publish') {
        const res = await apiFetch<SocialPost>(`/social/posts/${post.id}/publish`, { method: 'POST' });
        setNotice(res.status === 'publicado' ? 'Publicado' : `No se pudo publicar: ${res.errorMessage ?? 'error'}`);
      } else {
        await apiFetch<void>(`/social/posts/${post.id}`, { method: 'DELETE' });
        setNotice('Publicación eliminada');
      }
      setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const anyConfigured = PLATFORMS.some((p) => configured[p.value]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Redes</h1>
        <button style={btnPrimary} onClick={() => setEditing('new')}>
          + Nueva publicación
        </button>
      </header>

      <p style={{ color: colors.muted, fontSize: 14, marginTop: 0 }}>
        {PLATFORMS.map((p) => `${p.label}: ${configured[p.value] ? 'conectado ✔' : 'sin conectar'}`).join(' · ')}
        {!anyConfigured && ' — podés preparar borradores; para publicar falta cargar las claves de Meta en el servidor.'}
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select style={{ ...input, width: 180 }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Todos los estados</option>
          {POST_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select style={{ ...input, width: 180 }} value={platform} onChange={(e) => (setPlatform(e.target.value), setPage(1))}>
          <option value="">Todas las redes</option>
          {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button style={btnSecondary} onClick={() => setReload((r) => r + 1)} title="Las programadas se publican solas: actualizá para ver su estado">
          Actualizar
        </button>
      </div>

      {notice && (
        <p role="status" style={{ ...banner, background: '#ebfbee', borderColor: '#b2f2bb' }}>
          {notice}{' '}
          <button style={btnLink} onClick={() => setNotice(null)}>Cerrar</button>
        </p>
      )}
      {error && <p role="alert" style={{ ...banner, background: '#fff5f5', borderColor: '#ffc9c9', color: colors.danger }}>{error}</p>}

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted }}>
              <th style={th}>Publicación</th>
              <th style={th}>Red</th>
              <th style={th}>Estado</th>
              <th style={th}>Cuándo</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr><td style={td} colSpan={5}>Cargando…</td></tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...td, color: colors.muted }} colSpan={5}>
                  {status || platform ? 'No hay publicaciones con esos filtros.' : 'Todavía no hay publicaciones. Creá una con "Nueva publicación", o desde una propiedad con "Publicar".'}
                </td>
              </tr>
            )}
            {data?.items.map((p) => {
              const st = POST_STATUSES.find((s) => s.value === p.status);
              const text = captionOf(p.copy, p.hashtags);
              return (
                <tr key={p.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ ...td, maxWidth: 420 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {p.mediaUrls[0] && <img src={p.mediaUrls[0]} alt="" loading="lazy" style={thumb} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-line' }}>
                          {text || <em style={{ color: colors.muted }}>(sin texto)</em>}
                        </div>
                        <small style={{ color: colors.muted }}>
                          {p.mediaUrls.length ? `${p.mediaUrls.length} foto${p.mediaUrls.length > 1 ? 's' : ''}` : 'Solo texto'}
                          {p.property && ` · ${p.property.title}`}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td style={td}>{PLATFORMS.find((x) => x.value === p.platform)?.label ?? p.platform}</td>
                  <td style={td}>
                    {st && <span style={{ background: st.bg, color: st.fg, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500 }}>{st.label}</span>}
                    {p.status === 'fallido' && p.errorMessage && (
                      <small style={{ display: 'block', color: colors.danger, marginTop: 4, maxWidth: 240 }}>{p.errorMessage}</small>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: colors.muted }}>
                    {p.status === 'publicado' ? dateTime(p.publishedAt) : p.status === 'programado' ? dateTime(p.scheduledAt) : `Creada ${dateTime(p.createdAt)}`}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {busy === p.id ? (
                      <span style={{ color: colors.muted }}>…</span>
                    ) : (
                      <>
                        {p.externalUrl && (
                          <a href={p.externalUrl} target="_blank" rel="noreferrer" style={{ ...btnLink, textDecoration: 'none' }}>Ver</a>
                        )}
                        {EDITABLE.includes(p.status) && (
                          <>
                            {configured[p.platform] && (
                              <>
                                <button style={btnLink} onClick={() => act(p, 'publish')}>{p.status === 'fallido' ? 'Reintentar' : 'Publicar ya'}</button>
                                {' · '}
                              </>
                            )}
                            <button style={btnLink} onClick={() => setEditing(p)}>Editar</button>
                          </>
                        )}
                        {p.status !== 'publicando' && (
                          <>
                            {(p.externalUrl || EDITABLE.includes(p.status)) && ' · '}
                            <button style={{ ...btnLink, color: colors.danger }} onClick={() => act(p, 'delete')}>Eliminar</button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>← Anterior</button>
          <span style={{ fontSize: 14, color: colors.muted }}>Página {page} de {totalPages}</span>
          <button style={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente →</button>
        </div>
      )}

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Nueva publicación' : 'Editar publicación'} onClose={() => setEditing(null)}>
          <SocialPostForm
            post={editing === 'new' ? null : editing}
            configured={configured}
            onCancel={() => setEditing(null)}
            onDone={(msg) => {
              setEditing(null);
              setNotice(msg);
              setReload((r) => r + 1);
            }}
          />
        </Modal>
      )}
    </main>
  );
}

const th: CSSProperties = { padding: '12px 16px', fontWeight: 500 };
const td: CSSProperties = { padding: '12px 16px', verticalAlign: 'top' };
const thumb: CSSProperties = { width: 56, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: colors.soft };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
