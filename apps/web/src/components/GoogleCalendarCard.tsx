import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import { btnLink, btnSecondary, colors } from '../styles';

interface Status {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

/** Conexión del usuario logueado con su Google Calendar. */
export default function GoogleCalendarCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Status>('/integrations/google/status')
      .then(setStatus)
      .catch(() => undefined); // si falla, simplemente no se muestra la tarjeta
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/integrations/google/connect', { method: 'POST' });
      window.location.assign(url); // Google pide permiso y vuelve al CRM con ?google=...
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>('/integrations/google', { method: 'DELETE' });
      setStatus((s) => (s ? { ...s, connected: false, email: null } : s));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div style={box}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <div style={{ flex: 1, minWidth: 200, fontSize: 14 }}>
        {!status.configured ? (
          <span style={{ color: colors.muted }}>
            Google Calendar todavía no está configurado en el servidor. Cuando lo esté, cada asesor va a poder ver sus visitas en su calendario.
          </span>
        ) : status.connected ? (
          <>
            <strong>Google Calendar conectado</strong>
            <span style={{ color: colors.muted }}>
              {' '}
              · {status.email}. Las visitas de tus leads se copian solas; las por confirmar dicen "Por confirmar".
            </span>
          </>
        ) : (
          <>
            <strong>Conectá tu Google Calendar</strong>
            <span style={{ color: colors.muted }}> para ver ahí las visitas de tus leads, con dirección y teléfono del cliente.</span>
          </>
        )}
        {error && <div style={{ color: colors.danger, marginTop: 4 }}>{error}</div>}
      </div>
      {status.configured &&
        (status.connected ? (
          <button style={{ ...btnLink, color: colors.danger }} onClick={disconnect} disabled={busy}>
            Desconectar
          </button>
        ) : (
          <button style={btnSecondary} onClick={connect} disabled={busy}>
            {busy ? 'Abriendo Google…' : 'Conectar'}
          </button>
        ))}
    </div>
  );
}

const box: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  border: `1px solid ${colors.border}`,
  background: '#fff',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 16,
};
