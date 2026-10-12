import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import { STAGES, TEMPERATURES, formatPhone, leadName, timeAgo, type Lead } from '../api/leads';
import { OPERATIONS, labelOf, type Paginated } from '../api/properties';
import { getTeam, type TeamMember } from '../api/team';
import LeadDetail, { ScoreBar, TemperatureChip, budgetText } from '../components/LeadDetail';
import LeadForm from '../components/LeadForm';
import Modal from '../components/Modal';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';

const LIMIT = 15;

export default function Leads({ initialLeadId = null }: { initialLeadId?: string | null }) {
  const [data, setData] = useState<Paginated<Lead> | null>(null);
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState('');
  const [temperature, setTemperature] = useState('');
  const [assignee, setAssignee] = useState(''); // '' todos, 'me', 'none' o id de asesor
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [query, setQuery] = useState(''); // búsqueda aplicada
  const [queryInput, setQueryInput] = useState(''); // lo que se está escribiendo
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialLeadId);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeam()
      .then(setTeam)
      .catch(() => undefined); // sin equipo el filtro muestra solo "Mis leads" / "Sin asignar"
  }, []);

  useEffect(() => {
    if (selected) return; // en el detalle no hace falta la lista; se recarga al volver
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (stage) params.set('stage', stage);
    if (temperature) params.set('temperature', temperature);
    if (assignee) params.set('assignedTo', assignee);
    if (query) params.set('q', query);

    apiFetch<Paginated<Lead>>(`/leads?${params.toString()}`)
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
  }, [page, stage, temperature, assignee, query, reload, selected]);

  function search(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  if (selected) {
    return (
      <LeadDetail
        leadId={selected}
        onBack={() => setSelected(null)}
        onChanged={() => setReload((r) => r + 1)}
        onDeleted={(name) => {
          setNotice(`Se eliminó a "${name}"`);
          if (data && data.items.length === 1 && page > 1) setPage(page - 1);
          setSelected(null);
        }}
      />
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const filtered = Boolean(query || stage || temperature || assignee);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Leads</h1>
        <button style={btnPrimary} onClick={() => setCreating(true)}>
          + Nuevo lead
        </button>
      </header>

      <form onSubmit={search} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          style={{ ...input, width: 260, maxWidth: '100%' }}
          placeholder="Buscar por nombre, teléfono o email"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
        />
        <select
          style={{ ...input, width: 180 }}
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setPage(1);
          }}
          aria-label="Etapa"
        >
          <option value="">Todas las etapas</option>
          {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          style={{ ...input, width: 170 }}
          value={temperature}
          onChange={(e) => {
            setTemperature(e.target.value);
            setPage(1);
          }}
          aria-label="Temperatura"
        >
          <option value="">Toda temperatura</option>
          {TEMPERATURES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          style={{ ...input, width: 180 }}
          value={assignee}
          onChange={(e) => {
            setAssignee(e.target.value);
            setPage(1);
          }}
          aria-label="Asesor"
        >
          <option value="">Todos los asesores</option>
          <option value="me">Mis leads</option>
          <option value="none">Sin asignar</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
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
              <th style={th}>Lead</th>
              <th style={th}>Busca</th>
              <th style={th}>Etapa</th>
              <th style={th}>Asesor</th>
              <th style={th}>Puntaje</th>
              <th style={th}>Última interacción</th>
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
                  {filtered
                    ? 'No hay leads que coincidan con la búsqueda.'
                    : 'Todavía no hay leads. Se crean solos cuando alguien escribe por WhatsApp, o podés cargarlos con "Nuevo lead".'}
                </td>
              </tr>
            )}
            {data?.items.map((l) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${colors.border}`, cursor: 'pointer' }} onClick={() => setSelected(l.id)}>
                <td style={td}>
                  {/* El botón hace la fila accesible por teclado; el clic en la fila es un atajo para el mouse. */}
                  <button style={{ ...btnLink, fontWeight: 600, color: '#1f2937', textAlign: 'left' }} onClick={() => setSelected(l.id)}>
                    {leadName(l)}
                  </button>
                  <br />
                  <small style={{ color: colors.muted }}>{[formatPhone(l.phone), l.email].filter(Boolean).join(' · ')}</small>
                </td>
                <td style={td}>
                  {l.wantsOperation ? labelOf(OPERATIONS, l.wantsOperation) : '—'}
                  <br />
                  <small style={{ color: colors.muted }}>
                    {[budgetText(l) !== '—' ? budgetText(l) : '', l.preferredNeighborhoods.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
                  </small>
                </td>
                <td style={td}>{labelOf(STAGES, l.stage)}</td>
                <td style={{ ...td, color: l.assignedTo ? undefined : colors.muted }}>{l.assignedTo?.fullName ?? 'Sin asignar'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <TemperatureChip value={l.temperature} />
                  <div style={{ marginTop: 6, fontSize: 12, color: colors.muted }}>
                    <ScoreBar value={l.leadScore} /> {l.leadScore}
                  </div>
                </td>
                <td style={{ ...td, color: colors.muted, whiteSpace: 'nowrap' }}>{timeAgo(l.lastInteractionAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
          <button style={btnSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Anterior
          </button>
          <span style={{ fontSize: 14, color: colors.muted }}>
            Página {page} de {totalPages} · {data.total} leads
          </span>
          <button style={btnSecondary} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Siguiente →
          </button>
        </div>
      )}

      {creating && (
        <Modal title="Nuevo lead" onClose={() => setCreating(false)}>
          <LeadForm
            lead={null}
            onCancel={() => setCreating(false)}
            onSaved={(l) => {
              setCreating(false);
              setNotice(`Lead creado: ${leadName(l)} (puntaje ${l.leadScore})`);
              setSelected(l.id); // directo al detalle para ver sus matches
            }}
          />
        </Modal>
      )}
    </main>
  );
}

const th: CSSProperties = { padding: '12px 16px', fontWeight: 500 };
const td: CSSProperties = { padding: '12px 16px', verticalAlign: 'top' };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
