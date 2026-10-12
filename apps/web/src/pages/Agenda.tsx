import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';
import { dayKey, formatDay, formatPhone, formatTime, leadName, type Visit } from '../api/leads';
import GoogleCalendarCard from '../components/GoogleCalendarCard';
import { VisitActions, VisitStatusChip } from '../components/Visits';
import { btnLink, card, colors, input } from '../styles';

type Range = 'semana' | 'mes' | 'por_confirmar' | 'pasadas';

const RANGES: { value: Range; label: string }[] = [
  { value: 'semana', label: 'Próximos 7 días' },
  { value: 'mes', label: 'Próximos 30 días' },
  { value: 'por_confirmar', label: 'Por confirmar' },
  { value: 'pasadas', label: 'Últimos 30 días' },
];

const DAY_MS = 86_400_000;

function queryFor(range: Range, mine: boolean): string {
  // Desde el inicio de hoy, así las visitas de esta mañana también aparecen.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const p = new URLSearchParams();
  if (mine) p.set('mine', 'true');
  if (range === 'semana' || range === 'mes') {
    p.set('from', today.toISOString());
    p.set('to', new Date(today.getTime() + (range === 'semana' ? 7 : 30) * DAY_MS).toISOString());
  } else if (range === 'por_confirmar') {
    p.set('status', 'pendiente');
    p.set('from', today.toISOString());
  } else {
    p.set('from', new Date(today.getTime() - 30 * DAY_MS).toISOString());
    p.set('to', new Date().toISOString());
  }
  return p.toString();
}

export default function Agenda({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [range, setRange] = useState<Range>('semana');
  const [mine, setMine] = useState(false);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVisits(null);
    apiFetch<Visit[]>(`/visits?${queryFor(range, mine)}`)
      .then((v) => {
        if (cancelled) return;
        // "Últimos 30 días": lo más reciente primero
        setVisits(range === 'pasadas' ? [...v].reverse() : v);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [range, mine]);

  const groups: { key: string; label: string; items: Visit[] }[] = [];
  for (const v of visits ?? []) {
    const key = dayKey(v.startAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(v);
    else groups.push({ key, label: formatDay(v.startAt), items: [v] });
  }
  const todayKey = dayKey(new Date().toISOString());
  const pending = visits?.filter((v) => v.status === 'pendiente').length ?? 0;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Agenda de visitas</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginLeft: 'auto' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Solo mis visitas
        </label>
        <select style={{ ...input, width: 200 }} value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Período">
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </header>

      <GoogleCalendarCard />

      {pending > 0 && range !== 'por_confirmar' && (
        <p style={{ ...banner, background: '#fff9db', borderColor: '#ffec99' }}>
          Hay {pending} {pending === 1 ? 'visita' : 'visitas'} por confirmar (las pidió el asistente o se cargaron sin confirmar).
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...banner, background: '#fff5f5', borderColor: '#ffc9c9', color: colors.danger }}>
          {error}{' '}
          <button style={btnLink} onClick={() => setError(null)}>
            Cerrar
          </button>
        </p>
      )}

      {visits === null && !error && <p>Cargando…</p>}
      {visits?.length === 0 && (
        <p style={{ ...card, color: colors.muted }}>
          No hay visitas en este período. Se agendan desde el detalle de cada lead, o las pide el asistente por WhatsApp.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.key} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, textTransform: 'capitalize', margin: '0 0 8px', color: g.key === todayKey ? colors.primary : '#1f2937' }}>
            {g.key === todayKey ? `Hoy · ${g.label}` : g.label}
          </h2>
          <ul style={{ ...card, listStyle: 'none', margin: 0, padding: 0 }}>
            {g.items.map((v, i) => (
              <li key={v.id} style={{ ...row, borderTop: i ? `1px solid ${colors.border}` : 0, opacity: v.status === 'cancelada' ? 0.6 : 1 }}>
                <div style={{ width: 64, fontWeight: 600, fontSize: 15 }}>
                  {formatTime(v.startAt)}
                  <small style={{ display: 'block', fontWeight: 400, color: colors.muted }}>{v.durationMin} min</small>
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <button style={{ ...btnLink, fontWeight: 600, color: '#1f2937' }} onClick={() => onOpenLead(v.lead.id)}>
                    {leadName(v.lead)}
                  </button>{' '}
                  <small style={{ color: colors.muted }}>{formatPhone(v.lead.phone)}</small>
                  <div style={{ fontSize: 14 }}>
                    {v.property.title} <small style={{ color: colors.muted }}>· {v.property.address}, {v.property.neighborhood}</small>
                  </div>
                  {v.notes && <small style={{ display: 'block', color: colors.muted }}>{v.notes}</small>}
                  {!mine && (
                    <small style={{ display: 'block', color: colors.muted }}>Asesor: {v.lead.assignedTo?.fullName ?? 'sin asignar'}</small>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {v.googleEventId && <small style={{ color: colors.muted }}>en Google Calendar</small>}
                    {v.source === 'asistente' && <small style={{ color: colors.muted }}>vía asistente</small>}
                    <VisitStatusChip status={v.status} />
                  </span>
                  <VisitActions
                    visit={v}
                    onError={setError}
                    onChange={(u) => setVisits((prev) => prev?.map((x) => (x.id === u.id ? u : x)) ?? prev)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 16px', padding: '12px 16px' };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
