import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch, apiFetchBlob } from '../api/client';
import {
  BREAKDOWN_LABELS,
  FEEDBACKS,
  STAGES,
  TEMPERATURES,
  TEMPERATURE_COLORS,
  formatDateTime,
  formatDay,
  formatTime,
  formatPhone,
  leadName,
  timeAgo,
  whatsappLink,
  type ChatMessage,
  type Lead,
  type Match,
  type Visit,
} from '../api/leads';
import { OPERATIONS, PROPERTY_TYPES, formatArs, formatUsd, labelOf } from '../api/properties';
import { getTeam, type TeamMember } from '../api/team';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';
import LeadForm from './LeadForm';
import Modal from './Modal';
import { NewVisitForm, VisitActions, VisitStatusChip } from './Visits';

interface Props {
  leadId: string;
  onBack: () => void;
  /** Se guardó algo (etapa, perfil): la lista tiene que refrescarse al volver. */
  onChanged: () => void;
  onDeleted: (name: string) => void;
}

export default function LeadDetail({ leadId, onBack, onChanged, onDeleted }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [chats, setChats] = useState<ChatMessage[] | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [addingVisit, setAddingVisit] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fail = (e: Error) => !cancelled && setError(e.message);
    apiFetch<Lead>(`/leads/${leadId}`).then((l) => !cancelled && setLead(l)).catch(fail);
    apiFetch<ChatMessage[]>(`/leads/${leadId}/chats?limit=200`).then((c) => !cancelled && setChats(c)).catch(fail);
    apiFetch<Match[]>(`/lead-engine/leads/${leadId}/matches`).then((m) => !cancelled && setMatches(m)).catch(fail);
    apiFetch<Visit[]>(`/visits?leadId=${leadId}`).then((v) => !cancelled && setVisits(v)).catch(fail);
    getTeam().then((t) => !cancelled && setTeam(t)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function patchLead(changes: Partial<Lead>) {
    if (!lead) return;
    const previous = lead;
    setLead({ ...lead, ...changes });
    try {
      setLead(await apiFetch<Lead>(`/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(changes) }));
      onChanged();
    } catch (e) {
      setLead(previous);
      setError((e as Error).message);
    }
  }

  async function assign(userId: string) {
    if (!lead) return;
    setError(null);
    try {
      setLead(await apiFetch<Lead>(`/leads/${lead.id}/assign`, { method: 'PATCH', body: JSON.stringify({ userId: userId || null }) }));
      onChanged();
    } catch (e) {
      setError((e as Error).message); // p. ej. un asesor que intenta sacarle el lead a otro
    }
  }

  function onMessageSent(m: ChatMessage) {
    setChats((prev) => [...(prev ?? []), m]);
    // La API pausa al asistente cuando escribe un asesor.
    setLead((prev) => (prev ? { ...prev, aiPaused: true, lastInteractionAt: m.createdAt } : prev));
    onChanged();
  }

  async function reloadLead() {
    // Agendar una visita puede mover la etapa del lead.
    setLead(await apiFetch<Lead>(`/leads/${leadId}`));
    onChanged();
  }

  async function recalculate() {
    setMatching(true);
    setError(null);
    try {
      setMatches(await apiFetch<Match[]>(`/lead-engine/leads/${leadId}/match`, { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMatching(false);
    }
  }

  async function setFeedback(match: Match, value: Match['feedback']) {
    // Volver a tocar la opción elegida la desmarca.
    const feedback = match.feedback === value ? 'pendiente' : value;
    const update = (fb: Match['feedback']) =>
      setMatches((prev) => prev?.map((m) => (m.id === match.id ? { ...m, feedback: fb } : m)) ?? prev);
    update(feedback);
    try {
      await apiFetch(`/lead-engine/matches/${match.id}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback }) });
    } catch (e) {
      update(match.feedback);
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!lead) return;
    const name = leadName(lead);
    if (!window.confirm(`¿Eliminar a "${name}"? Se borra también su conversación y sus matches.`)) return;
    try {
      await apiFetch<void>(`/leads/${lead.id}`, { method: 'DELETE' });
      onDeleted(name);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <button style={{ ...btnLink, marginBottom: 12 }} onClick={onBack}>
        ← Volver a leads
      </button>

      {error && (
        <p role="alert" style={{ ...banner, background: '#fff5f5', borderColor: '#ffc9c9', color: colors.danger }}>
          {error}{' '}
          <button style={btnLink} onClick={() => setError(null)}>
            Cerrar
          </button>
        </p>
      )}

      {!lead ? (
        !error && <p>Cargando…</p>
      ) : (
        <>
          <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
            <div style={{ flex: '1 1 300px' }}>
              <h1 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {leadName(lead)} <TemperatureChip value={lead.temperature} />
              </h1>
              <div style={{ fontSize: 14, color: colors.muted, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {lead.phone && (
                  <a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" style={{ color: colors.primary }}>
                    {formatPhone(lead.phone)} (WhatsApp)
                  </a>
                )}
                {lead.email && <span>{lead.email}</span>}
                <span>Última interacción: {timeAgo(lead.lastInteractionAt)}</span>
              </div>
            </div>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 4, color: colors.muted }}>Etapa</span>
              <select style={{ ...input, width: 190 }} value={lead.stage} onChange={(e) => patchLead({ stage: e.target.value })}>
                {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ display: 'block', marginBottom: 4, color: colors.muted }}>Asesor a cargo</span>
              <select style={{ ...input, width: 190 }} value={lead.assignedTo?.id ?? ''} onChange={(e) => assign(e.target.value)}>
                <option value="">Sin asignar</option>
                {/* si el asesor actual fue desactivado no figura en el equipo: se muestra igual */}
                {lead.assignedTo && !team.some((m) => m.id === lead.assignedTo!.id) && (
                  <option value={lead.assignedTo.id}>{lead.assignedTo.fullName}</option>
                )}
                {team.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
              <button style={btnSecondary} onClick={() => setEditing(true)}>
                Editar
              </button>
              <button style={{ ...btnSecondary, color: colors.danger }} onClick={remove}>
                Eliminar
              </button>
            </div>
          </header>

          <section style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 32px' }}>
              <Stat label="Puntaje">
                <ScoreBar value={lead.leadScore} /> {lead.leadScore}/100
              </Stat>
              <Stat label="Busca">
                {[lead.wantsOperation && labelOf(OPERATIONS, lead.wantsOperation), lead.wantedTypes.map((t) => labelOf(PROPERTY_TYPES, t)).join(', ')]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </Stat>
              <Stat label="Presupuesto">{budgetText(lead)}</Stat>
              <Stat label="Barrios">{lead.preferredNeighborhoods.join(', ') || '—'}</Stat>
              <Stat label="Ambientes">{lead.minRooms ? `${lead.minRooms} o más` : '—'}</Stat>
              <Stat label="Cochera">{lead.needsGarage ? 'Necesita' : 'No es requisito'}</Stat>
              <Stat label="Crédito">{lead.hasMortgageApproval == null ? 'No sabemos' : lead.hasMortgageApproval ? 'Preaprobado' : 'No'}</Stat>
              <Stat label="Urgencia">{Math.round(lead.urgency * 100)}%</Stat>
            </div>
          </section>

          <section style={{ ...card, padding: 0, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
              <h2 style={panelTitle}>Visitas</h2>
              {!addingVisit && (
                <button style={btnSecondary} onClick={() => setAddingVisit(true)}>
                  + Agendar visita
                </button>
              )}
            </div>
            <div style={{ padding: '0 16px 16px', display: 'grid', gap: 10 }}>
              {addingVisit && (
                <NewVisitForm
                  lead={lead}
                  suggested={(matches ?? []).filter((m) => m.property.status === 'disponible').map((m) => m.property)}
                  onCancel={() => setAddingVisit(false)}
                  onCreated={(v) => {
                    setVisits((prev) => [...(prev ?? []), v].sort((a, b) => a.startAt.localeCompare(b.startAt)));
                    setAddingVisit(false);
                    void reloadLead();
                  }}
                />
              )}
              <VisitRows
                visits={visits}
                onChange={(v) => setVisits((prev) => prev?.map((x) => (x.id === v.id ? v : x)) ?? prev)}
                onError={setError}
              />
            </div>
          </section>

          <div style={columns}>
            <section style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingRight: 16, flexWrap: 'wrap' }}>
                <h2 style={panelTitle}>Conversación</h2>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Con el asistente pausado, los mensajes del cliente quedan acá y responde un asesor.">
                  <input type="checkbox" checked={!lead.aiPaused} onChange={(e) => patchLead({ aiPaused: !e.target.checked })} />
                  Asistente IA {lead.aiPaused ? <strong style={{ color: '#e67700' }}>pausado</strong> : 'respondiendo'}
                </label>
              </div>
              <ChatThread messages={chats} />
              <Composer lead={lead} onSent={onMessageSent} />
            </section>

            <section style={{ ...card, padding: 0, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
                <h2 style={panelTitle}>Propiedades sugeridas</h2>
                <button style={{ ...btnPrimary, opacity: matching ? 0.7 : 1 }} onClick={recalculate} disabled={matching}>
                  {matching ? 'Calculando…' : 'Recalcular'}
                </button>
              </div>
              <MatchList matches={matches} onFeedback={setFeedback} />
            </section>
          </div>
        </>
      )}

      {editing && lead && (
        <Modal title="Editar lead" onClose={() => setEditing(false)}>
          <LeadForm
            lead={lead}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setLead(saved);
              setEditing(false);
              onChanged();
            }}
          />
        </Modal>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ chat

function ChatThread({ messages }: { messages: ChatMessage[] | null }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages]);

  if (messages === null) return <p style={emptyText}>Cargando…</p>;
  if (messages.length === 0) {
    return <p style={emptyText}>Todavía no hay mensajes. Cuando escriba por WhatsApp, la conversación con el asistente aparece acá.</p>;
  }

  return (
    <div style={{ overflowY: 'auto', maxHeight: 560, padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {messages.map((m) => {
        if (m.role === 'system') {
          return (
            <p key={m.id} role="note" style={systemNote}>
              {m.content}
            </p>
          );
        }
        const mine = m.role !== 'user';
        const agent = m.role === 'agent';
        const notes = toolNotes(m);
        return (
          <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
            <div style={{ ...bubble, background: agent ? '#d3f9d8' : mine ? '#e7f0ff' : colors.soft, borderBottomRightRadius: mine ? 4 : 12, borderBottomLeftRadius: mine ? 12 : 4 }}>
              {m.mediaType && <Attachment message={m} />}
              {m.mediaType === 'audio' ? (
                m.content ? (
                  <span>
                    <small style={{ color: colors.muted }}>Transcripción: </small>
                    {m.content}
                  </span>
                ) : (
                  <small style={{ color: colors.muted }}>No se pudo transcribir el audio.</small>
                )
              ) : (
                m.content
              )}
            </div>
            {notes.map((n) => (
              <div key={n} style={{ fontSize: 12, color: '#2b8a3e', marginTop: 3, textAlign: mine ? 'right' : 'left' }}>
                {n}
              </div>
            ))}
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
              {agent ? `Asesor${m.authorName ? `: ${m.authorName}` : ''}` : mine ? 'Asistente IA' : 'Cliente'} · {formatDateTime(m.createdAt)}
            </div>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}

/** Foto o audio del cliente. Se piden con la sesión (son privados), así que no alcanza con un src directo. */
function Attachment({ message }: { message: ChatMessage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const isImage = message.mediaType === 'image';

  async function load() {
    setState('loading');
    try {
      setUrl(URL.createObjectURL(await apiFetchBlob(`/chat-media/${message.id}`)));
      setState('idle');
    } catch {
      setState('error');
    }
  }

  // Las fotos se cargan solas; los audios recién cuando el asesor toca "Escuchar".
  useEffect(() => {
    if (isImage && message.mediaFile) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  if (!message.mediaFile) {
    return <small style={{ display: 'block', color: colors.muted }}>{isImage ? 'Foto' : 'Audio'} no disponible (no se pudo descargar de WhatsApp).</small>;
  }
  if (state === 'error') return <small style={{ display: 'block', color: colors.danger }}>No se pudo cargar {isImage ? 'la foto' : 'el audio'}.</small>;

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" title="Abrir en tamaño completo" style={{ display: 'block', marginBottom: 4 }}>
        <img src={url} alt="Foto enviada por el cliente" style={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 8 }} />
      </a>
    ) : (
      <div style={{ width: 180, height: 120, borderRadius: 8, background: colors.border, marginBottom: 4 }} aria-label="Cargando foto" />
    );
  }
  return url ? (
    <audio controls autoPlay src={url} style={{ display: 'block', maxWidth: '100%', marginBottom: 4 }} />
  ) : (
    <button type="button" onClick={load} disabled={state === 'loading'} style={{ ...btnSecondary, padding: '3px 10px', fontSize: 13, marginBottom: 4 }}>
      {state === 'loading' ? 'Cargando…' : 'Escuchar audio'}
    </button>
  );
}

/** Resume lo que el asistente anotó con sus herramientas (perfil, visitas). */
function toolNotes(m: ChatMessage): string[] {
  const calls = m.extractedData?.toolCalls ?? [];
  return calls.map((c) => {
    const i = c.input as Record<string, unknown>;
    if (c.name === 'schedule_visit') {
      const when = typeof i.start_iso === 'string' ? formatDateTime(i.start_iso) : 'sin fecha';
      return `Pidió una visita para el ${when}`;
    }
    if (c.name === 'update_lead_profile') {
      const parts: string[] = [];
      if (i.operation) parts.push(labelOf(OPERATIONS, String(i.operation)).toLowerCase());
      if (typeof i.budget_max_usd === 'number') parts.push(`hasta ${formatUsd(i.budget_max_usd)}`);
      if (Array.isArray(i.neighborhoods) && i.neighborhoods.length) parts.push(i.neighborhoods.join(', '));
      if (typeof i.min_rooms === 'number') parts.push(`${i.min_rooms}+ amb.`);
      if (i.needs_garage === true) parts.push('con cochera');
      if (typeof i.urgency === 'number') parts.push(`urgencia ${Math.round(i.urgency * 100)}%`);
      return `Perfil actualizado${parts.length ? `: ${parts.join(' · ')}` : ''}`;
    }
    return `Acción: ${c.name}`;
  });
}

interface MessagingWindow {
  open: boolean;
  closesAt: string | null;
  templateAvailable: boolean;
  templatePending: boolean;
}

/**
 * Respuesta del asesor por WhatsApp. Enter envía; Shift+Enter hace un salto de línea.
 * Respeta la ventana de 24 h: fuera de ella solo se puede mandar la plantilla aprobada.
 */
function Composer({ lead, onSent }: { lead: Lead; onSent: (m: ChatMessage) => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState<MessagingWindow | null>(null);

  useEffect(() => {
    if (!lead.phone) return;
    let cancelled = false;
    apiFetch<MessagingWindow>(`/leads/${lead.id}/messages/window`)
      .then((w) => !cancelled && setWin(w))
      .catch(() => undefined); // si falla, el envío igual valida la ventana del lado de la API
    return () => {
      cancelled = true;
    };
  }, [lead.id, lead.phone, lead.lastInteractionAt]);

  if (!lead.phone) {
    return <p style={{ ...emptyText, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>Sin teléfono cargado: no se le puede escribir por WhatsApp.</p>;
  }

  async function post(path: string, body?: object) {
    setSending(true);
    setError(null);
    try {
      const saved = await apiFetch<ChatMessage>(path, { method: 'POST', body: body && JSON.stringify(body) });
      onSent(saved); // cambia lastInteractionAt: el efecto de arriba vuelve a consultar la ventana
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (await post(`/leads/${lead.id}/messages`, { text: body })) setText('');
  }

  const closed = win !== null && !win.open;

  return (
    <form onSubmit={send} style={{ borderTop: `1px solid ${colors.border}`, padding: 12 }}>
      {closed && (
        <div style={windowBanner}>
          {win.templatePending ? (
            <>Ya le mandaste la plantilla de saludo. Cuando conteste vas a poder escribirle de nuevo.</>
          ) : (
            <>
              Pasaron más de 24 h desde su último mensaje (o nunca escribió): WhatsApp solo deja mandar una plantilla aprobada.
              {win.templateAvailable ? (
                <button
                  type="button"
                  style={{ ...btnSecondary, display: 'block', marginTop: 8, padding: '6px 12px' }}
                  disabled={sending}
                  onClick={() => void post(`/leads/${lead.id}/messages/template`)}
                >
                  {sending ? 'Enviando…' : 'Enviar plantilla de saludo'}
                </button>
              ) : (
                <> Falta configurarla (WHATSAPP_REENGAGE_TEMPLATE). Mientras tanto, llamalo o escribile desde tu WhatsApp.</>
              )}
            </>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          style={{ ...input, minHeight: 42, maxHeight: 160, resize: 'vertical', flex: 1, background: closed ? colors.soft : '#fff' }}
          rows={2}
          value={text}
          maxLength={4096}
          disabled={closed}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={closed ? 'Conversación cerrada por WhatsApp' : 'Escribile por WhatsApp como asesor…'}
          aria-label="Mensaje para el cliente"
        />
        <button type="submit" style={{ ...btnPrimary, opacity: sending || closed || !text.trim() ? 0.6 : 1 }} disabled={sending || closed || !text.trim()}>
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: '6px 0 0' }}>
          {error}
        </p>
      ) : (
        !closed && (
          <small style={{ display: 'block', color: colors.muted, marginTop: 6 }}>
            {win?.closesAt ? `Podés escribirle hasta el ${formatDateTime(win.closesAt)}. ` : ''}
            Al responder vos, el asistente IA se pausa para este cliente.
          </small>
        )
      )}
    </form>
  );
}

// ---------------------------------------------------------------- visitas

function VisitRows({ visits, onChange, onError }: { visits: Visit[] | null; onChange: (v: Visit) => void; onError: (m: string) => void }) {
  if (visits === null) return <p style={{ ...emptyText, padding: 0 }}>Cargando…</p>;
  if (visits.length === 0) return <p style={{ ...emptyText, padding: 0 }}>No tiene visitas agendadas.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {visits.map((v) => (
        <li key={v.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
          <span style={{ minWidth: 170 }}>
            <strong style={{ textTransform: 'capitalize' }}>{formatDay(v.startAt)}</strong> · {formatTime(v.startAt)}
          </span>
          <span style={{ flex: '1 1 180px', fontSize: 14 }}>
            {v.property.title} <small style={{ color: colors.muted }}>· {v.property.address}</small>
            {v.notes && <small style={{ display: 'block', color: colors.muted }}>{v.notes}</small>}
          </span>
          <VisitStatusChip status={v.status} />
          {v.source === 'asistente' && <small style={{ color: colors.muted }}>La pidió el asistente</small>}
          <VisitActions visit={v} onChange={onChange} onError={onError} />
        </li>
      ))}
    </ul>
  );
}

// --------------------------------------------------------------- matches

function MatchList({ matches, onFeedback }: { matches: Match[] | null; onFeedback: (m: Match, v: Match['feedback']) => void }) {
  if (matches === null) return <p style={emptyText}>Cargando…</p>;
  if (matches.length === 0) {
    return (
      <p style={emptyText}>
        No hay sugerencias guardadas. Tocá "Recalcular" para buscar propiedades disponibles que encajen (puntaje 40 o más).
      </p>
    );
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {matches.map((m) => {
        const p = m.property;
        const unavailable = p.status !== 'disponible';
        return (
          <li key={m.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 10, padding: 12, opacity: unavailable ? 0.65 : 1 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              {p.photoUrls[0] ? (
                <img src={p.photoUrls[0]} alt="" loading="lazy" style={matchThumb} />
              ) : (
                <div style={{ ...matchThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: colors.muted }}>
                  Sin foto
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{p.title}</strong>
                  <span style={{ fontWeight: 700, color: scoreColor(m.score), whiteSpace: 'nowrap' }} title="Afinidad con el perfil">
                    {Math.round(m.score)}%
                  </span>
                </div>
                <div style={{ fontSize: 13, color: colors.muted }}>
                  {p.neighborhood} · {labelOf(PROPERTY_TYPES, p.type)} · {p.rooms} amb.
                  {unavailable && <strong style={{ color: colors.danger }}> · Ya no está disponible</strong>}
                </div>
                <div style={{ fontSize: 14, marginTop: 2 }}>
                  {formatUsd(p.priceUsd)} <small style={{ color: colors.muted }}>{formatArs(p.priceArs)}</small>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
              {Object.keys(BREAKDOWN_LABELS)
                .filter((k) => k in m.breakdown)
                .map((k) => (
                  <span key={k} style={{ fontSize: 12, color: colors.muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {BREAKDOWN_LABELS[k]} <ScoreBar value={m.breakdown[k] * 100} width={36} />
                  </span>
                ))}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }} role="group" aria-label="Respuesta del cliente">
              {FEEDBACKS.map((f) => {
                const on = m.feedback === f.value;
                return (
                  <button
                    key={f.value}
                    onClick={() => onFeedback(m, f.value)}
                    aria-pressed={on}
                    style={{ ...feedbackBtn, background: on ? colors.primary : '#fff', color: on ? '#fff' : '#1f2937', borderColor: on ? colors.primary : '#cfd6e4' }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- piezas

export function TemperatureChip({ value }: { value: string }) {
  const c = TEMPERATURE_COLORS[value] ?? TEMPERATURE_COLORS.frio;
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
      {labelOf(TEMPERATURES, value)}
    </span>
  );
}

export function ScoreBar({ value, width = 60 }: { value: number; width?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span aria-hidden style={{ display: 'inline-block', width, height: 6, borderRadius: 3, background: colors.border, verticalAlign: 'middle' }}>
      <span style={{ display: 'block', width: `${v}%`, height: '100%', borderRadius: 3, background: scoreColor(v) }} />
    </span>
  );
}

function scoreColor(v: number): string {
  return v >= 70 ? '#2b8a3e' : v >= 40 ? '#e67700' : '#868e96';
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

export function budgetText(l: Lead): string {
  if (l.budgetMinUsd && l.budgetMaxUsd) return `${formatUsd(l.budgetMinUsd)} a ${formatUsd(l.budgetMaxUsd)}`;
  if (l.budgetMaxUsd) return `Hasta ${formatUsd(l.budgetMaxUsd)}`;
  if (l.budgetMinUsd) return `Desde ${formatUsd(l.budgetMinUsd)}`;
  return '—';
}

const columns: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 20, alignItems: 'start' };
const panelTitle: CSSProperties = { fontSize: 16, margin: 0, padding: 16 };
const windowBanner: CSSProperties = {
  fontSize: 13,
  background: '#fff9db',
  border: '1px solid #ffec99',
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: 8,
};
const systemNote: CSSProperties = {
  alignSelf: 'center',
  fontSize: 12,
  color: '#8a5a00',
  background: '#fff9db',
  border: '1px solid #ffec99',
  borderRadius: 6,
  padding: '4px 10px',
  margin: '4px 0',
  maxWidth: '90%',
};
const emptyText: CSSProperties = { color: colors.muted, fontSize: 14, padding: '0 16px 16px', margin: 0 };
const bubble: CSSProperties = { padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const matchThumb: CSSProperties = { width: 88, height: 66, objectFit: 'cover', borderRadius: 6, background: colors.soft, flexShrink: 0 };
const feedbackBtn: CSSProperties = { border: '1px solid', borderRadius: 20, padding: '4px 12px', fontSize: 13, cursor: 'pointer' };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
