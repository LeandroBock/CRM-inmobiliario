import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import {
  VISIT_STATUSES,
  VISIT_STATUS_COLORS,
  isoToLocalInput,
  localInputToIso,
  type Lead,
  type Visit,
} from '../api/leads';
import { labelOf, type Paginated, type Property } from '../api/properties';
import { btnLink, btnPrimary, btnSecondary, colors, input } from '../styles';

export function VisitStatusChip({ status }: { status: string }) {
  const c = VISIT_STATUS_COLORS[status] ?? VISIT_STATUS_COLORS.realizada;
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {labelOf(VISIT_STATUSES, status)}
    </span>
  );
}

/** Botones según el estado: confirmar, marcar realizada, cancelar, reprogramar. */
export function VisitActions({ visit, onChange, onError }: { visit: Visit; onChange: (v: Visit) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [when, setWhen] = useState(() => isoToLocalInput(visit.startAt));

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const updated = await apiFetch<Visit>(`/visits/${visit.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      // El PATCH devuelve la visita con lead y propiedad; se conserva lo que ya teníamos por las dudas.
      onChange({ ...visit, ...updated });
      setRescheduling(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (rescheduling) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="datetime-local" style={{ ...input, width: 'auto', padding: '4px 8px', fontSize: 13 }} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Nueva fecha y hora" />
        <button style={smallBtn} disabled={busy || !when} onClick={() => patch({ startAt: localInputToIso(when) })}>
          Guardar
        </button>
        <button style={{ ...btnLink, fontSize: 13 }} onClick={() => setRescheduling(false)}>
          Cancelar
        </button>
      </span>
    );
  }

  const active = visit.status === 'pendiente' || visit.status === 'confirmada';
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {visit.status === 'pendiente' && (
        <button style={{ ...smallBtn, background: colors.primary, color: '#fff', borderColor: colors.primary }} disabled={busy} onClick={() => patch({ status: 'confirmada' })}>
          Confirmar
        </button>
      )}
      {visit.status === 'confirmada' && (
        <button style={smallBtn} disabled={busy} onClick={() => patch({ status: 'realizada' })}>
          Se hizo
        </button>
      )}
      {active && (
        <>
          <button style={smallBtn} disabled={busy} onClick={() => setRescheduling(true)}>
            Reprogramar
          </button>
          <button style={{ ...smallBtn, color: colors.danger }} disabled={busy} onClick={() => patch({ status: 'cancelada' })}>
            Cancelar visita
          </button>
        </>
      )}
      {!active && (
        <button style={{ ...btnLink, fontSize: 13 }} disabled={busy} onClick={() => patch({ status: 'confirmada' })}>
          Reactivar
        </button>
      )}
    </span>
  );
}

interface NewVisitProps {
  lead: Lead;
  /** Propiedades sugeridas para el lead: aparecen primero en la lista. */
  suggested: Property[];
  onCreated: (v: Visit) => void;
  onCancel: () => void;
}

export function NewVisitForm({ lead, suggested, onCreated, onCancel }: NewVisitProps) {
  const [available, setAvailable] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState(suggested[0]?.id ?? '');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('45');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Paginated<Property>>('/properties?status=disponible&limit=100')
      .then((d) => setAvailable(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  const suggestedIds = new Set(suggested.map((p) => p.id));
  const others = available.filter((p) => !suggestedIds.has(p.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!propertyId) return setError('Elegí la propiedad');
    if (!when) return setError('Elegí día y hora');
    setSaving(true);
    setError(null);
    try {
      const visit = await apiFetch<Visit>('/visits', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id, propertyId, startAt: localInputToIso(when), durationMin: Number(duration), notes: notes.trim() || undefined }),
      });
      const property = [...suggested, ...available].find((p) => p.id === propertyId)!;
      onCreated({ ...visit, lead, property });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const option = (p: Property) => (
    <option key={p.id} value={p.id}>
      {p.title} · {p.neighborhood}
    </option>
  );

  return (
    <form onSubmit={submit} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
      <label style={label}>
        Propiedad
        <select style={input} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">Elegí una…</option>
          {suggested.length > 0 && <optgroup label="Sugeridas para este lead">{suggested.map(option)}</optgroup>}
          {others.length > 0 && <optgroup label="Otras disponibles">{others.map(option)}</optgroup>}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label style={label}>
          Día y hora (Argentina)
          <input type="datetime-local" style={input} value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label style={label}>
          Duración
          <select style={input} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
      </div>
      <label style={label}>
        Notas (opcional)
        <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: lo acompaña la pareja, pedir llaves al portero" />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span role="alert" style={{ color: colors.danger, fontSize: 13, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} disabled={saving}>
          {saving ? 'Agendando…' : 'Agendar'}
        </button>
      </div>
    </form>
  );
}

const smallBtn: CSSProperties = {
  border: '1px solid #cfd6e4',
  background: '#fff',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 13,
  cursor: 'pointer',
};
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 };
