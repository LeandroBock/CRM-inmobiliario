import { useEffect, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import { STAGES, type Lead } from '../api/leads';
import { OPERATIONS, PROPERTY_TYPES, parseAmount } from '../api/properties';
import { getTeam, type TeamMember } from '../api/team';
import { btnPrimary, btnSecondary, colors, input } from '../styles';

interface Props {
  /** null = alta; con un lead = edición. */
  lead: Lead | null;
  onSaved: (saved: Lead) => void;
  onCancel: () => void;
}

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  stage: string;
  wantsOperation: string;
  budgetMinUsd: string;
  budgetMaxUsd: string;
  wantedTypes: string[];
  preferredNeighborhoods: string;
  minRooms: string;
  needsGarage: boolean;
  /** '' = no sabemos */
  hasMortgageApproval: '' | 'si' | 'no';
  /** Solo en el alta. '' = quien lo carga. */
  assignedUserId: string;
}

function initialState(l: Lead | null): FormState {
  return {
    fullName: l?.fullName ?? '',
    phone: l?.phone ?? '',
    email: l?.email ?? '',
    stage: l?.stage ?? 'nuevo',
    wantsOperation: l?.wantsOperation ?? '',
    budgetMinUsd: l?.budgetMinUsd != null ? String(l.budgetMinUsd) : '',
    budgetMaxUsd: l?.budgetMaxUsd != null ? String(l.budgetMaxUsd) : '',
    wantedTypes: l?.wantedTypes ?? [],
    preferredNeighborhoods: l?.preferredNeighborhoods.join(', ') ?? '',
    minRooms: l?.minRooms != null ? String(l.minRooms) : '',
    needsGarage: l?.needsGarage ?? false,
    hasMortgageApproval: l?.hasMortgageApproval == null ? '' : l.hasMortgageApproval ? 'si' : 'no',
    assignedUserId: '',
  };
}

/** Vacío -> null (al editar, null borra el dato). NaN -> error. */
function optionalAmount(raw: string, name: string): number | null | string {
  const n = parseAmount(raw);
  if (n === null) return null;
  return Number.isNaN(n) || n < 0 ? `${name} no es un número válido` : n;
}

function buildPayload(f: FormState, editing: boolean): { payload?: Record<string, unknown>; error?: string } {
  const fullName = f.fullName.trim();
  const phone = f.phone.trim();
  const email = f.email.trim();
  if (fullName && fullName.length < 2) return { error: 'El nombre debe tener al menos 2 letras' };
  if (!phone && !email) return { error: 'Cargá al menos un teléfono o un email' };
  if (phone && phone.replace(/\D/g, '').length < 8) return { error: 'El teléfono parece incompleto' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'El email no es válido' };

  const min = optionalAmount(f.budgetMinUsd, 'El presupuesto mínimo');
  const max = optionalAmount(f.budgetMaxUsd, 'El presupuesto máximo');
  if (typeof min === 'string') return { error: min };
  if (typeof max === 'string') return { error: max };
  if (min !== null && max !== null && min > max) return { error: 'El presupuesto mínimo no puede superar al máximo' };

  let minRooms: number | null = null;
  if (f.minRooms.trim()) {
    if (!/^\d+$/.test(f.minRooms.trim())) return { error: 'Los ambientes tienen que ser un número entero' };
    minRooms = Number(f.minRooms.trim());
  }

  const payload: Record<string, unknown> = {
    stage: f.stage,
    wantedTypes: f.wantedTypes,
    preferredNeighborhoods: f.preferredNeighborhoods.split(',').map((s) => s.trim()).filter(Boolean),
    needsGarage: f.needsGarage,
  };
  // En el alta los vacíos se omiten; al editar se mandan como null para poder borrar un dato cargado.
  const optional: Record<string, unknown> = {
    fullName: fullName || null,
    phone: phone || null,
    email: email || null,
    wantsOperation: f.wantsOperation || null,
    budgetMinUsd: min,
    budgetMaxUsd: max,
    minRooms,
    hasMortgageApproval: f.hasMortgageApproval === '' ? null : f.hasMortgageApproval === 'si',
  };
  for (const [k, v] of Object.entries(optional)) if (v !== null || editing) payload[k] = v;
  if (!editing && f.assignedUserId) payload.assignedUserId = f.assignedUserId;
  return { payload };
}

export default function LeadForm({ lead, onSaved, onCancel }: Props) {
  const [f, setF] = useState<FormState>(() => initialState(lead));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!lead) getTeam().then(setTeam).catch(() => undefined); // al editar, el asesor se cambia desde la ficha
  }, [lead]);

  const set =
    (key: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setF((prev) => ({ ...prev, [key]: value }));
    };

  function toggleType(type: string) {
    setF((prev) => ({
      ...prev,
      wantedTypes: prev.wantedTypes.includes(type) ? prev.wantedTypes.filter((t) => t !== type) : [...prev.wantedTypes, type],
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { payload, error: validation } = buildPayload(f, lead !== null);
    if (!payload) {
      setError(validation ?? 'Revisá los datos');
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<Lead>(lead ? `/leads/${lead.id}` : '/leads', {
        method: lead ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ overflowY: 'auto', padding: 20 }}>
        <h3 style={{ ...sectionTitle, marginTop: 0 }}>Contacto</h3>
        <div style={grid}>
          <Field label="Nombre">
            <input style={input} value={f.fullName} onChange={set('fullName')} autoFocus />
          </Field>
          <Field label="Teléfono" hint="Con código de área: 341 555-1234. Es el que se usa en WhatsApp.">
            <input style={input} type="tel" value={f.phone} onChange={set('phone')} placeholder="341 555-1234" />
          </Field>
          <Field label="Email">
            <input style={input} type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Etapa">
            <select style={input} value={f.stage} onChange={set('stage')}>
              {STAGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {!lead && (
            <Field label="Asesor a cargo">
              <select style={input} value={f.assignedUserId} onChange={set('assignedUserId')}>
                <option value="">Yo</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </Field>
          )}
        </div>

        <h3 style={sectionTitle}>Qué busca</h3>
        <div style={grid}>
          <Field label="Operación">
            <select style={input} value={f.wantsOperation} onChange={set('wantsOperation')}>
              <option value="">Sin definir</option>
              {OPERATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Presupuesto mínimo (USD)">
            <input style={input} inputMode="decimal" value={f.budgetMinUsd} onChange={set('budgetMinUsd')} placeholder="80.000" />
          </Field>
          <Field label="Presupuesto máximo (USD)">
            <input style={input} inputMode="decimal" value={f.budgetMaxUsd} onChange={set('budgetMaxUsd')} placeholder="120.000" />
          </Field>
          <Field label="Ambientes mínimos">
            <input style={input} inputMode="numeric" value={f.minRooms} onChange={set('minRooms')} />
          </Field>
          <Field label="Barrios" hint="Separados por coma" wide>
            <input style={input} value={f.preferredNeighborhoods} onChange={set('preferredNeighborhoods')} placeholder="Pichincha, Centro, Fisherton" />
          </Field>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
          <legend style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Tipo de propiedad</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PROPERTY_TYPES.map((t) => {
              const on = f.wantedTypes.includes(t.value);
              return (
                <label key={t.value} style={{ ...pill, background: on ? colors.soft : '#fff', borderColor: on ? colors.primary : '#cfd6e4' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleType(t.value)} style={{ margin: 0 }} />
                  {t.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div style={{ ...grid, marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={f.needsGarage} onChange={(e) => setF((p) => ({ ...p, needsGarage: e.target.checked }))} />
            Necesita cochera
          </label>
          <Field label="Crédito hipotecario preaprobado">
            <select style={input} value={f.hasMortgageApproval} onChange={set('hasMortgageApproval')}>
              <option value="">No sabemos</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        <p style={{ fontSize: 13, color: colors.muted, margin: '14px 0 0' }}>
          El puntaje y la temperatura se calculan solos al guardar, según lo completo del perfil, la urgencia y la actividad reciente.
        </p>
      </div>

      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" onClick={onCancel} style={btnSecondary} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} disabled={saving}>
          {saving ? 'Guardando…' : lead ? 'Guardar cambios' : 'Crear lead'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'block', gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: colors.muted, marginTop: 4 }}>{hint}</small>}
    </label>
  );
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 };
const sectionTitle: CSSProperties = { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, margin: '22px 0 10px' };
const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid',
  borderRadius: 20,
  padding: '5px 12px',
  fontSize: 14,
  cursor: 'pointer',
};
const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '14px 20px',
  borderTop: `1px solid ${colors.border}`,
};
