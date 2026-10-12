import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch, AUTH_EVENT, tokenStore } from './api/client';
import NotificationBell from './components/NotificationBell';
import Agenda from './pages/Agenda';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Login, { type SessionUser } from './pages/Login';
import Properties from './pages/Properties';
import Social from './pages/Social';
import Team from './pages/Team';
import { btnLink, colors } from './styles';

type PageId = 'panel' | 'propiedades' | 'leads' | 'agenda' | 'redes' | 'equipo';

const PAGES: { id: PageId; label: string; adminOnly?: boolean }[] = [
  { id: 'panel', label: 'Panel' },
  { id: 'propiedades', label: 'Propiedades' },
  { id: 'leads', label: 'Leads' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'redes', label: 'Redes' },
  { id: 'equipo', label: 'Equipo', adminOnly: true },
];

export default function App() {
  /**
   * Parámetros con los que se abrió la web: ?google=... (vuelta de conectar Google Calendar) o ?lead=<id> (link de un
   * email de aviso). Se leen una sola vez y se sacan de la URL; si hay que loguearse primero, se aplican después.
   */
  const [entry] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get('google');
    const lead = params.get('lead');
    if (google || lead) window.history.replaceState(null, '', window.location.pathname);
    return { google, lead: lead && /^[0-9a-f-]{36}$/i.test(lead) ? lead : null };
  });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<PageId>(entry.lead ? 'leads' : entry.google ? 'agenda' : 'panel');
  /**
   * Lead a abrir al entrar a Leads desde otra pantalla (agenda, avisos, email). `n` cambia en cada pedido
   * para que la pantalla se vuelva a montar aunque sea el mismo lead.
   */
  const [leadToOpen, setLeadToOpen] = useState<{ id: string; n: number } | null>(entry.lead ? { id: entry.lead, n: 1 } : null);
  const openLead = useCallback((id: string) => {
    setLeadToOpen((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
    setPage('leads');
  }, []);
  const googleResult = entry.google;
  const [googleNotice, setGoogleNotice] = useState<string | null>(() =>
    googleResult === 'conectado'
      ? 'Listo: tu Google Calendar quedó conectado. Las visitas de tus leads ya se están copiando.'
      : googleResult === 'cancelado'
        ? 'Cancelaste la conexión con Google Calendar.'
        : googleResult
          ? 'No se pudo conectar Google Calendar. Probá de nuevo; si sigue fallando, avisale al administrador.'
          : null,
  );
  // Si hay un token guardado, primero se valida contra la API antes de decidir qué pantalla mostrar.
  const [checking, setChecking] = useState(() => tokenStore.get() !== null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setPage('panel');
  }, []);

  // La API respondió 401 con sesión activa: el token venció o fue revocado.
  useEffect(() => {
    window.addEventListener(AUTH_EVENT, logout);
    return () => window.removeEventListener(AUTH_EVENT, logout);
  }, [logout]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    apiFetch<SessionUser>('/auth/me')
      .then(setUser)
      .catch(() => undefined) // sin API o token inválido: se muestra el login
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <nav style={bar}>
        <strong style={{ marginRight: 12 }}>CRM Cognitivo</strong>
        {PAGES.filter((p) => !p.adminOnly || user.role === 'admin').map((p) => (
          <button key={p.id} onClick={() => {
              setLeadToOpen(null);
              setPage(p.id);
            }} style={tab(page === p.id)} aria-current={page === p.id ? 'page' : undefined}>
            {p.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }}>
          <NotificationBell onOpenLead={openLead} />
        </span>
        <span style={{ fontSize: 14, color: colors.muted }}>
          {user.fullName} ·{' '}
          <button onClick={logout} style={btnLink}>
            Cerrar sesión
          </button>
        </span>
      </nav>
      {googleNotice && (
        <p role="status" style={{ margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8, fontSize: 14, border: '1px solid', ...(googleResult === 'conectado' ? { background: '#ebfbee', borderColor: '#b2f2bb' } : { background: '#fff9db', borderColor: '#ffec99' }) }}>
          {googleNotice}{' '}
          <button style={btnLink} onClick={() => setGoogleNotice(null)}>
            Cerrar
          </button>
        </p>
      )}
      {page === 'panel' && <Dashboard />}
      {page === 'propiedades' && <Properties />}
      {page === 'redes' && <Social />}
      {/* key: abrir otro lead desde la agenda vuelve a montar la pantalla con ese lead */}
      {page === 'leads' && <Leads key={leadToOpen?.n ?? 0} initialLeadId={leadToOpen?.id ?? null} />}
      {page === 'equipo' && user.role === 'admin' && <Team currentUserId={user.id} />}
      {page === 'agenda' && (
        <Agenda
          onOpenLead={openLead}
        />
      )}
    </div>
  );
}

const bar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  padding: '10px 24px',
  background: '#fff',
  borderBottom: `1px solid ${colors.border}`,
};

const tab = (active: boolean): CSSProperties => ({
  border: 0,
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: 14,
  cursor: 'pointer',
  background: active ? colors.soft : 'transparent',
  color: active ? colors.primary : '#1f2937',
  fontWeight: active ? 600 : 400,
});
