import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import { timeAgo } from '../api/leads';
import { btnLink, colors } from '../styles';

interface AppNotification {
  id: string;
  type: 'visita_por_confirmar' | 'cliente_esperando' | 'lead_caliente' | 'lead_asignado';
  title: string;
  body?: string | null;
  leadId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

const POLL_MS = 30_000;

const TYPE_COLOR: Record<AppNotification['type'], string> = {
  cliente_esperando: '#c92a2a',
  visita_por_confirmar: '#e67700',
  lead_caliente: '#2b8a3e',
  lead_asignado: colors.primary,
};

export default function NotificationBell({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailAlerts, setEmailAlerts] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    apiFetch<{ count: number }>('/notifications/unread-count')
      .then((r) => setCount(r.count))
      .catch(() => undefined); // sin red un rato: se reintenta en el próximo ciclo
  }, []);

  // Consulta periódica, y al volver a la pestaña (los navegadores frenan los timers en pestañas ocultas).
  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && refreshCount();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError(null);
    apiFetch<AppNotification[]>('/notifications')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
    apiFetch<{ emailAlerts: boolean }>('/auth/me')
      .then((me) => setEmailAlerts(me.emailAlerts))
      .catch(() => undefined);
    // Clic afuera o Esc cierran el panel.
    const onClick = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function select(n: AppNotification) {
    if (!n.readAt) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
      setCount((c) => Math.max(0, c - 1));
      apiFetch<void>(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => refreshCount());
    }
    if (n.leadId) {
      setOpen(false);
      onOpenLead(n.leadId);
    }
  }

  async function toggleEmail(value: boolean) {
    setEmailAlerts(value);
    try {
      await apiFetch('/auth/me/preferences', { method: 'PATCH', body: JSON.stringify({ emailAlerts: value }) });
    } catch (e) {
      setEmailAlerts(!value);
      setError((e as Error).message);
    }
  }

  async function readAll() {
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? now })) ?? prev);
      setCount(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={bellBtn}
        aria-expanded={open}
        aria-label={count ? `Avisos: ${count} sin leer` : 'Avisos'}
        title="Avisos"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && <span style={badge}>{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Avisos" style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${colors.border}` }}>
            <strong style={{ fontSize: 14 }}>Avisos</strong>
            {count > 0 && (
              <button style={{ ...btnLink, fontSize: 13 }} onClick={readAll}>
                Marcar todos como leídos
              </button>
            )}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {error && <p style={{ ...empty, color: colors.danger }}>{error}</p>}
            {!items && !error && <p style={empty}>Cargando…</p>}
            {items?.length === 0 && <p style={empty}>No hay avisos todavía.</p>}
            {items?.map((n) => (
              <button key={n.id} onClick={() => select(n)} style={{ ...item, background: n.readAt ? '#fff' : '#f5f8ff' }}>
                <span style={{ ...dot, background: n.readAt ? 'transparent' : TYPE_COLOR[n.type] }} aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: n.readAt ? 400 : 600, fontSize: 14 }}>{n.title}</span>
                  {n.body && <span style={{ display: 'block', fontSize: 13, color: colors.muted, overflowWrap: 'anywhere' }}>{n.body}</span>}
                  <span style={{ display: 'block', fontSize: 12, color: colors.muted, marginTop: 2 }}>{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          {emailAlerts !== null && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', fontSize: 13, color: colors.muted, borderTop: `1px solid ${colors.border}` }}>
              <input type="checkbox" checked={emailAlerts} onChange={(e) => toggleEmail(e.target.checked)} />
              Recibir estos avisos también por email
            </label>
          )}
        </div>
      )}
    </div>
  );
}

const bellBtn: CSSProperties = {
  position: 'relative',
  border: 0,
  background: 'transparent',
  borderRadius: 8,
  padding: 7,
  cursor: 'pointer',
  color: '#1f2937',
  display: 'flex',
};
const badge: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: 8,
  background: colors.danger,
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: '16px',
  textAlign: 'center',
  boxSizing: 'border-box',
};
const panel: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  width: 'min(360px, calc(100vw - 32px))',
  background: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.15)',
  zIndex: 20,
  overflow: 'hidden',
};
const item: CSSProperties = {
  display: 'flex',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  border: 0,
  borderBottom: `1px solid ${colors.border}`,
  padding: '10px 14px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#1f2937',
};
const dot: CSSProperties = { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 };
const empty: CSSProperties = { fontSize: 14, color: colors.muted, padding: '14px', margin: 0 };
