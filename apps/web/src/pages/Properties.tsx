import { lazy, Suspense, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import {
  OPERATIONS,
  PROPERTY_TYPES,
  STATUSES,
  formatArs,
  formatShortDate,
  formatUsd,
  labelOf,
  type Paginated,
  type Property,
} from '../api/properties';
import Appraisal from '../components/Appraisal';
import PropertySheet from '../components/PropertySheet';
import Modal from '../components/Modal';
import SocialPostForm from '../components/SocialPostForm';
import PropertyForm from '../components/PropertyForm';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';

/** El armador de reels trae la librería de video (~270 KB): se descarga recién al abrirlo. */
const ReelBuilder = lazy(() => import('../components/ReelBuilder'));

const LIMIT = 10;

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  disponible: { bg: '#d3f9d8', fg: '#2b8a3e' },
  reservada: { bg: '#fff3bf', fg: '#e67700' },
  vendida: { bg: '#e7e9ee', fg: '#495057' },
  pausada: { bg: '#e7e9ee', fg: '#495057' },
};

export default function Properties() {
  const [data, setData] = useState<Paginated<Property> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState(''); // búsqueda aplicada
  const [queryInput, setQueryInput] = useState(''); // lo que se está escribiendo
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Property | 'new' | null>(null);
  /** Tasación abierta: una propiedad cargada, o 'nueva' para tasar algo que no está en el CRM. */
  const [appraising, setAppraising] = useState<Property | 'nueva' | null>(null);
  /** Publicar una propiedad en redes (arranca con su texto sugerido y sus fotos). */
  const [publishing, setPublishing] = useState<{ property: Property; videoUrl?: string } | null>(null);
  /** Armar un reel con las fotos de la propiedad (al terminar, abre la publicación con el video). */
  const [makingReel, setMakingReel] = useState<Property | null>(null);
  /** Ficha en PDF abierta. */
  const [sheetFor, setSheetFor] = useState<Property | null>(null);
  const [socialConfigured, setSocialConfigured] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiFetch<Record<string, boolean>>('/social/status').then(setSocialConfigured).catch(() => undefined);
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set('status', status);
    if (query) params.set('q', query);

    apiFetch<Paginated<Property>>(`/properties?${params.toString()}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [page, status, query, reload]);

  function search(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  function onSaved(p: Property) {
    const creating = editing === 'new';
    setEditing(null);
    setNotice(
      `${creating ? 'Propiedad creada' : 'Cambios guardados'}: ${p.title} · ${formatUsd(p.priceUsd)} · ${formatArs(p.priceArs)} ` +
        `(dólar ${p.fxSource} $${p.fxRate} del ${formatShortDate(p.fxRateDate)})`,
    );
    if (creating) setPage(1); // las nuevas aparecen primero
    setReload((r) => r + 1);
  }

  async function remove(p: Property) {
    if (!window.confirm(`¿Eliminar "${p.title}"? Esta acción no se puede deshacer.`)) return;
    try {
      await apiFetch<void>(`/properties/${p.id}`, { method: 'DELETE' });
      setNotice(`Se eliminó "${p.title}"`);
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      else setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Propiedades</h1>
        <span style={{ display: 'flex', gap: 8 }}>
          <button style={btnSecondary} onClick={() => setAppraising('nueva')}>
            Tasar
          </button>
          <button style={btnPrimary} onClick={() => setEditing('new')}>
            + Nueva propiedad
          </button>
        </span>
      </header>

      <form onSubmit={search} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          style={{ ...input, width: 260 }}
          placeholder="Buscar por título o dirección"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
        />
        <select
          style={{ ...input, width: 170 }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" style={btnSecondary}>
          Buscar
        </button>
      </form>

      {notice && (
        <p role="status" style={{ ...banner, background: '#ebfbee', borderColor: '#b2f2bb' }}>
          {notice}{' '}
          <button style={btnLink} onClick={() => setNotice(null)}>
            Cerrar
          </button>
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...banner, background: '#fff5f5', borderColor: '#ffc9c9', color: colors.danger }}>
          {error}
        </p>
      )}

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted }}>
              <th style={th}>Propiedad</th>
              <th style={th}>Tipo</th>
              <th style={th}>Superficie</th>
              <th style={th}>Precio</th>
              <th style={th}>Estado</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {data === null && !error && (
              <tr>
                <td style={td} colSpan={6}>
                  Cargando…
                </td>
              </tr>
            )}
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...td, color: colors.muted }} colSpan={6}>
                  {query || status
                    ? 'No hay propiedades que coincidan con la búsqueda.'
                    : 'Todavía no cargaste propiedades. Empezá con "Nueva propiedad".'}
                </td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={td}>
                  <strong>{p.title}</strong>
                  <br />
                  <small style={{ color: colors.muted }}>
                    {p.address} · {p.neighborhood}, {p.city}
                  </small>
                </td>
                <td style={td}>
                  {labelOf(PROPERTY_TYPES, p.type)}
                  <br />
                  <small style={{ color: colors.muted }}>{labelOf(OPERATIONS, p.operation)}</small>
                </td>
                <td style={td}>
                  {p.coveredM2} m²
                  <br />
                  <small style={{ color: colors.muted }}>{p.rooms} amb.</small>
                </td>
                <td style={td}>
                  <strong>{formatUsd(p.priceUsd)}</strong>
                  <br />
                  <small
                    style={{ color: colors.muted }}
                    title={`Cotización ${p.fxSource} $${p.fxRate} del ${formatShortDate(p.fxRateDate)}`}
                  >
                    {formatArs(p.priceArs)}
                  </small>
                </td>
                <td style={td}>
                  <Chip status={p.status}>{labelOf(STATUSES, p.status)}</Chip>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button style={btnLink} onClick={() => setAppraising(p)}>
                    Tasar
                  </button>
                  {' · '}
                  <button style={btnLink} onClick={() => setPublishing({ property: p })}>
                    Publicar
                  </button>
                  {' · '}
                  <button style={btnLink} onClick={() => setMakingReel(p)} disabled={p.photoUrls.length < 2} title={p.photoUrls.length < 2 ? 'Hacen falta al menos 2 fotos' : undefined}>
                    Reel
                  </button>
                  {' · '}
                  <button style={btnLink} onClick={() => setSheetFor(p)}>
                    Ficha
                  </button>
                  {' · '}
                  <button style={btnLink} onClick={() => setEditing(p)}>
                    Editar
                  </button>
                  {' · '}
                  <button style={{ ...btnLink, color: colors.danger }} onClick={() => remove(p)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Anterior
          </button>
          <span style={{ fontSize: 14, color: colors.muted }}>
            Página {page} de {totalPages} · {data.total} propiedades
          </span>
          <button style={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Siguiente →
          </button>
        </div>
      )}

      {sheetFor !== null && (
        <Modal title={`Ficha PDF: ${sheetFor.title}`} onClose={() => setSheetFor(null)}>
          <PropertySheet property={sheetFor} onClose={() => setSheetFor(null)} />
        </Modal>
      )}

      {makingReel !== null && (
        <Modal title={`Crear reel: ${makingReel.title}`} onClose={() => setMakingReel(null)}>
          <Suspense fallback={<p style={{ padding: 20 }}>Cargando…</p>}>
            <ReelBuilder
            property={makingReel}
            onCancel={() => setMakingReel(null)}
            onUse={(videoUrl) => {
              setPublishing({ property: makingReel, videoUrl });
              setMakingReel(null);
            }}
          />
          </Suspense>
        </Modal>
      )}

      {publishing !== null && (
        <Modal title={`Publicar en redes: ${publishing.property.title}`} onClose={() => setPublishing(null)}>
          <SocialPostForm
            post={null}
            initialProperty={publishing.property}
            initialVideoUrl={publishing.videoUrl ?? null}
            configured={socialConfigured}
            onCancel={() => setPublishing(null)}
            onDone={(msg) => {
              setPublishing(null);
              setNotice(`${msg}. La ves en la pestaña Redes.`);
            }}
          />
        </Modal>
      )}

      {appraising !== null && (
        <Modal title="Tasación" onClose={() => setAppraising(null)}>
          <Appraisal property={appraising === 'nueva' ? null : appraising} onClose={() => setAppraising(null)} />
        </Modal>
      )}

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Nueva propiedad' : 'Editar propiedad'} onClose={() => setEditing(null)}>
          <PropertyForm property={editing === 'new' ? null : editing} onSaved={onSaved} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </main>
  );
}

function Chip({ status, children }: { status: string; children: ReactNode }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.pausada;
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 500 }}>
      {children}
    </span>
  );
}

const th: CSSProperties = { padding: '12px 16px', fontWeight: 500 };
const td: CSSProperties = { padding: '12px 16px', verticalAlign: 'top' };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
