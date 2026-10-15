import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import type { Paginated, Property } from '../api/properties';
import { ADJUSTMENT_INDEXES, CONTRACT_STATUSES, type AdjustmentIndex, type ContractStatus, type RentalContract, type RentCurrency } from '../api/rentals';
import { btnLink, btnPrimary, colors, input } from '../styles';

interface Props {
  /** null = contrato nuevo. */
  contract: RentalContract | null;
  /** Con ajustes ya aplicados no se puede cambiar el monto inicial ni la fecha de inicio. */
  locked?: boolean;
  onSaved: (c: RentalContract) => void;
  onCancel: () => void;
}

const addYears = (date: string, years: number) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;

export default function RentalForm({ contract, locked = false, onSaved, onCancel }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [properties, setProperties] = useState<Property[]>([]);
  const [f, setF] = useState({
    propertyId: contract?.property.id ?? '',
    tenantName: contract?.tenantName ?? '',
    tenantPhone: contract?.tenantPhone ?? '',
    tenantEmail: contract?.tenantEmail ?? '',
    tenantDocument: contract?.tenantDocument ?? '',
    ownerName: contract?.ownerName ?? '',
    ownerPhone: contract?.ownerPhone ?? '',
    ownerEmail: contract?.ownerEmail ?? '',
    startDate: contract?.startDate ?? today,
    endDate: contract?.endDate ?? addYears(today, 2),
    currency: (contract?.currency ?? 'ARS') as RentCurrency,
    initialRent: contract ? String(contract.initialRent) : '',
    paymentDueDay: String(contract?.paymentDueDay ?? 10),
    adjustmentIndex: (contract?.adjustmentIndex ?? 'ipc') as AdjustmentIndex,
    adjustmentEveryMonths: String(contract?.adjustmentEveryMonths ?? 4),
    fixedRatePct: contract?.fixedRatePct != null ? String(contract.fixedRatePct) : '',
    deposit: contract?.deposit != null ? String(contract.deposit) : '',
    adminFeePct: contract?.adminFeePct != null ? String(contract.adminFeePct) : '',
    notes: contract?.notes ?? '',
    status: (contract?.status ?? 'activo') as ContractStatus,
  });
  // Contrato que ya venía de antes: por defecto, pagado hasta el mes pasado
  const thisMonth = today.slice(0, 7);
  const lastMonth = (() => {
    const [y, m] = thisMonth.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();
  const [paidUpTo, setPaidUpTo] = useState(lastMonth);
  const [markPaid, setMarkPaid] = useState(true);
  const startedBefore = !contract && f.startDate.slice(0, 7) < thisMonth;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Paginated<Property>>('/properties?limit=100')
      .then((d) => setProperties(d.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  // Montos: "500.000" = quinientos mil. Porcentajes: "10,5" o "10.5" = diez y medio.
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));
  const pctNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.propertyId) return setError('Elegí la propiedad');
    setSaving(true);
    setError(null);
    const body = {
      propertyId: f.propertyId,
      tenantName: f.tenantName,
      tenantPhone: f.tenantPhone,
      tenantEmail: f.tenantEmail,
      tenantDocument: f.tenantDocument,
      ownerName: f.ownerName,
      ownerPhone: f.ownerPhone,
      ownerEmail: f.ownerEmail,
      startDate: f.startDate,
      endDate: f.endDate,
      currency: f.currency,
      initialRent: num(f.initialRent),
      paymentDueDay: Number(f.paymentDueDay),
      adjustmentIndex: f.adjustmentIndex,
      adjustmentEveryMonths: Number(f.adjustmentEveryMonths),
      fixedRatePct: f.adjustmentIndex === 'fijo' ? pctNum(f.fixedRatePct) : null,
      deposit: num(f.deposit),
      adminFeePct: pctNum(f.adminFeePct),
      notes: f.notes,
      ...(contract ? { status: f.status } : {}),
      ...(startedBefore && markPaid && paidUpTo >= f.startDate.slice(0, 7) ? { paidThrough: `${paidUpTo}-01` } : {}),
    };
    try {
      const saved = await apiFetch<RentalContract>(contract ? `/rentals/${contract.id}` : '/rentals', {
        method: contract ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const idx = ADJUSTMENT_INDEXES.find((i) => i.value === f.adjustmentIndex)!;

  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, overflowY: 'auto' }}>
        <Section title="Propiedad">
          <select style={input} value={f.propertyId} onChange={(e) => set('propertyId', e.target.value)} aria-label="Propiedad" required>
            <option value="">Elegí la propiedad…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.address}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Inquilino">
          <div style={grid}>
            <Field label="Nombre y apellido *">
              <input style={input} value={f.tenantName} onChange={(e) => set('tenantName', e.target.value)} required />
            </Field>
            <Field label="Teléfono">
              <input style={input} value={f.tenantPhone} onChange={(e) => set('tenantPhone', e.target.value)} placeholder="+54 9 341 …" />
            </Field>
            <Field label="Email">
              <input style={input} type="email" value={f.tenantEmail} onChange={(e) => set('tenantEmail', e.target.value)} />
            </Field>
            <Field label="DNI / CUIT">
              <input style={input} value={f.tenantDocument} onChange={(e) => set('tenantDocument', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Propietario">
          <div style={grid}>
            <Field label="Nombre y apellido *">
              <input style={input} value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} required />
            </Field>
            <Field label="Teléfono">
              <input style={input} value={f.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input style={input} type="email" value={f.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Plazo y montos">
          <div style={grid}>
            <Field label="Inicio *" hint={locked ? 'Tiene ajustes aplicados: no se puede cambiar' : undefined}>
              <input style={input} type="date" value={f.startDate} disabled={locked} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="Fin *">
              <input style={input} type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
            <Field label="Moneda">
              <select style={input} value={f.currency} onChange={(e) => set('currency', e.target.value as RentCurrency)}>
                <option value="ARS">Pesos</option>
                <option value="USD">Dólares</option>
              </select>
            </Field>
            <Field label="Alquiler inicial *">
              <input style={input} inputMode="decimal" value={f.initialRent} disabled={locked} onChange={(e) => set('initialRent', e.target.value)} placeholder="500000" />
            </Field>
            <Field label="Día de pago (1 a 28)">
              <input style={input} type="number" min={1} max={28} value={f.paymentDueDay} onChange={(e) => set('paymentDueDay', e.target.value)} />
            </Field>
            <Field label="Depósito">
              <input style={input} inputMode="decimal" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} />
            </Field>
            <Field label="Comisión de administración (%)" hint="Lo que se le descuenta al propietario">
              <input style={input} inputMode="decimal" value={f.adminFeePct} onChange={(e) => set('adminFeePct', e.target.value)} />
            </Field>
          </div>
        </Section>

        {startedBefore && (
          <Section title="Pagos anteriores">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, flexWrap: 'wrap' }}>
              <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
              El contrato ya venía de antes: los meses hasta
              <input type="month" style={{ ...input, display: 'inline-block', width: 200, padding: '5px 8px' }} value={paidUpTo} min={f.startDate.slice(0, 7)} max={thisMonth} disabled={!markPaid} onChange={(e) => setPaidUpTo(e.target.value)} aria-label="Pagado hasta" />
              ya están pagos
            </label>
            <small style={{ display: 'block', color: colors.muted, marginTop: 4 }}>Se registran como pagos del monto inicial. Si hubo ajustes antes de cargarlo al CRM, conviene poner como inicio la fecha del último ajuste.</small>
          </Section>
        )}

        <Section title="Ajustes">
          <div style={grid}>
            <Field label="Índice" hint={idx.hint}>
              <select style={input} value={f.adjustmentIndex} onChange={(e) => set('adjustmentIndex', e.target.value as AdjustmentIndex)}>
                {ADJUSTMENT_INDEXES.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cada cuántos meses">
              <select style={input} value={f.adjustmentEveryMonths} onChange={(e) => set('adjustmentEveryMonths', e.target.value)}>
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Todos los meses' : `Cada ${n} meses`}
                  </option>
                ))}
              </select>
            </Field>
            {f.adjustmentIndex === 'fijo' && (
              <Field label="Porcentaje por período *">
                <input style={input} inputMode="decimal" value={f.fixedRatePct} onChange={(e) => set('fixedRatePct', e.target.value)} placeholder="10" />
              </Field>
            )}
          </div>
        </Section>

        <Section title="Otros">
          {contract && (
            <Field label="Estado">
              <select style={{ ...input, maxWidth: 240 }} value={f.status} onChange={(e) => set('status', e.target.value as ContractStatus)}>
                {CONTRACT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Notas">
            <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Garantía, servicios a cargo de cada parte, etc." />
          </Field>
        </Section>
      </div>
      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnLink} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} disabled={saving}>
          {saving ? 'Guardando…' : contract ? 'Guardar cambios' : 'Crear contrato'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
      <legend style={{ fontSize: 12, fontWeight: 700, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, padding: 0 }}>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <small style={{ display: 'block', color: colors.muted, marginTop: 3 }}>{hint}</small>}
    </label>
  );
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 12px' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };
