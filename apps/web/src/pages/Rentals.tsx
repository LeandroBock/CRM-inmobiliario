import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import {
  ADJUSTMENT_INDEXES,
  CONTRACT_STATUSES,
  formatDay,
  formatPeriod,
  money,
  pctChange,
  todayAr,
  type ContractDetail,
  type ContractStatus,
  type ContractSummary,
  type IndexValue,
  type PeriodStatus,
} from '../api/rentals';
import Modal from '../components/Modal';
import RentalForm from '../components/RentalForm';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';

interface Props {
  initialContractId: string | null;
  isAdmin: boolean;
}

export default function Rentals({ initialContractId, isAdmin }: Props) {
  const [openId, setOpenId] = useState<string | null>(initialContractId);
  const [list, setList] = useState<ContractSummary[] | null>(null);
  const [status, setStatus] = useState<ContractStatus | ''>('activo');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (openId) return;
    setList(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    apiFetch<ContractSummary[]>(`/rentals?${params}`)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [status, reload, openId]);

  if (openId) {
    return (
      <ContractView
        id={openId}
        isAdmin={isAdmin}
        onBack={() => {
          setOpenId(null);
          setReload((r) => r + 1);
        }}
      />
    );
  }

  const today = todayAr();
  const totalDebt = (list ?? []).reduce((s, c) => s + (c.contract.currency === 'ARS' ? c.debt : 0), 0);

  return (
    <main style={page}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Alquileres</h1>
        <button style={btnPrimary} onClick={() => setCreating(true)}>
          + Nuevo contrato
        </button>
      </header>

      <IndexesCard isAdmin={isAdmin} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setReload((r) => r + 1);
        }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}
      >
        <input style={{ ...input, width: 280 }} placeholder="Buscar por inquilino, propietario o propiedad" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...input, width: 170 }} value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')}>
          <option value="">Todos</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}s
            </option>
          ))}
        </select>
        <button type="submit" style={btnSecondary}>
          Buscar
        </button>
        {totalDebt > 0 && <span style={{ alignSelf: 'center', color: colors.danger, fontSize: 14 }}>Deuda total en pesos: {money(totalDebt)}</span>}
      </form>

      {error && <p role="alert" style={{ color: colors.danger }}>{error}</p>}

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted }}>
              <th style={th}>Propiedad</th>
              <th style={th}>Inquilino</th>
              <th style={th}>Alquiler</th>
              <th style={th}>Próximo ajuste</th>
              <th style={th}>Vence</th>
              <th style={th}>Pagos</th>
            </tr>
          </thead>
          <tbody>
            {list === null && !error && (
              <tr>
                <td style={td} colSpan={6}>
                  Cargando…
                </td>
              </tr>
            )}
            {list?.length === 0 && (
              <tr>
                <td style={{ ...td, color: colors.muted }} colSpan={6}>
                  {q || status !== 'activo' ? 'No hay contratos que coincidan.' : 'Todavía no cargaste contratos. Empezá con "Nuevo contrato".'}
                </td>
              </tr>
            )}
            {list?.map(({ contract: c, debt, overdueMonths, current }) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${colors.border}`, cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                <td style={td}>
                  <button style={{ ...btnLink, fontWeight: 600, textAlign: 'left' }} onClick={() => setOpenId(c.id)}>
                    {c.property.title}
                  </button>
                  <br />
                  <small style={{ color: colors.muted }}>{c.property.address}</small>
                </td>
                <td style={td}>
                  {c.tenantName}
                  <br />
                  <small style={{ color: colors.muted }}>Prop.: {c.ownerName}</small>
                </td>
                <td style={td}>
                  <strong>{money(c.currentRent, c.currency)}</strong>
                  <br />
                  <small style={{ color: colors.muted }}>{ADJUSTMENT_INDEXES.find((i) => i.value === c.adjustmentIndex)?.label} · c/{c.adjustmentEveryMonths} m</small>
                </td>
                <td style={td}>
                  {c.nextAdjustmentDate ? (
                    <span style={{ color: c.nextAdjustmentDate <= today ? '#7048e8' : undefined, fontWeight: c.nextAdjustmentDate <= today ? 600 : undefined }}>
                      {formatDay(c.nextAdjustmentDate)}
                      {c.nextAdjustmentDate <= today && ' · pendiente'}
                    </span>
                  ) : (
                    <span style={{ color: colors.muted }}>—</span>
                  )}
                </td>
                <td style={td}>
                  <span style={{ color: c.endDate <= addDays(today, 60) ? '#e67700' : undefined }}>{formatDay(c.endDate)}</span>
                  {c.status !== 'activo' && (
                    <>
                      <br />
                      <StatusChip status={c.status} />
                    </>
                  )}
                </td>
                <td style={td}>
                  {debt > 0 ? (
                    <span style={{ color: colors.danger, fontWeight: 600 }}>
                      Debe {money(debt, c.currency)}
                      <br />
                      <small>
                        {overdueMonths} {overdueMonths === 1 ? 'mes' : 'meses'}
                      </small>
                    </span>
                  ) : current && current.balance > 0 ? (
                    <span style={{ color: colors.muted }}>
                      Este mes: pendiente
                      <br />
                      <small>vence el {formatDay(current.dueDate)}</small>
                    </span>
                  ) : (
                    <span style={{ color: '#2b8a3e' }}>Al día</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal title="Nuevo contrato de alquiler" onClose={() => setCreating(false)}>
          <RentalForm
            contract={null}
            onCancel={() => setCreating(false)}
            onSaved={(c) => {
              setCreating(false);
              setOpenId(c.id);
            }}
          />
        </Modal>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- detalle

function ContractView({ id, isAdmin, onBack }: { id: string; isAdmin: boolean; onBack: () => void }) {
  const [c, setC] = useState<ContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<PeriodStatus | null>(null);

  const load = useCallback(() => {
    apiFetch<ContractDetail>(`/rentals/${id}`)
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!c) {
    return (
      <main style={page}>
        <button style={btnLink} onClick={onBack}>
          ← Volver a alquileres
        </button>
        <p>{error ?? 'Cargando…'}</p>
      </main>
    );
  }

  const removeContract = () => {
    if (!window.confirm(`¿Eliminar el contrato de ${c.tenantName}? Se borran también sus pagos y ajustes.`)) return;
    void act(async () => {
      await apiFetch(`/rentals/${c.id}`, { method: 'DELETE' });
      onBack();
    });
  };

  return (
    <main style={page}>
      <button style={btnLink} onClick={onBack}>
        ← Volver a alquileres
      </button>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', margin: '10px 0 16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>{c.property.title}</h1>
          <span style={{ color: colors.muted, fontSize: 14 }}>
            {c.property.address} · {formatDay(c.startDate)} al {formatDay(c.endDate)} <StatusChip status={c.status} />
          </span>
        </div>
        <span style={{ display: 'flex', gap: 8 }}>
          <button style={btnSecondary} onClick={() => setEditing(true)}>
            Editar
          </button>
          {isAdmin && (
            <button style={{ ...btnSecondary, color: colors.danger }} onClick={removeContract}>
              Eliminar
            </button>
          )}
        </span>
      </header>

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat label="Alquiler actual" value={money(c.currentRent, c.currency)} sub={`Inicial: ${money(c.initialRent, c.currency)}`} />
        <Stat label="Deuda" value={c.debt > 0 ? money(c.debt, c.currency) : 'Al día'} sub={c.debt > 0 ? `${c.overdueMonths} ${c.overdueMonths === 1 ? 'mes vencido' : 'meses vencidos'}` : `Paga el día ${c.paymentDueDay}`} danger={c.debt > 0} />
        <Stat
          label="Ajuste"
          value={ADJUSTMENT_INDEXES.find((i) => i.value === c.adjustmentIndex)!.label}
          sub={`Cada ${c.adjustmentEveryMonths} ${c.adjustmentEveryMonths === 1 ? 'mes' : 'meses'}${c.adjustmentIndex === 'fijo' && c.fixedRatePct ? ` · ${c.fixedRatePct}%` : ''}`}
        />
      </div>

      <AdjustmentBox contract={c} isAdmin={isAdmin} onDone={(msg) => act(async () => undefined, msg)} onError={setError} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <section style={card}>
          <h2 style={h2}>Pagos mes a mes</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted }}>
                <th style={th2}>Mes</th>
                <th style={th2}>Alquiler</th>
                <th style={th2}>Pagado</th>
                <th style={th2} />
              </tr>
            </thead>
            <tbody>
              {c.periods.map((p) => (
                <tr key={p.period} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={td2}>{formatPeriod(p.period)}</td>
                  <td style={td2}>{money(p.due, c.currency)}</td>
                  <td style={{ ...td2, color: p.overdue ? colors.danger : p.balance === 0 ? '#2b8a3e' : undefined }}>
                    {p.balance === 0 ? '✓ Pago' : p.paid > 0 ? `${money(p.paid, c.currency)} (falta ${money(p.balance, c.currency)})` : p.overdue ? 'Vencido' : `Vence ${formatDay(p.dueDate)}`}
                  </td>
                  <td style={{ ...td2, textAlign: 'right' }}>
                    {p.balance > 0 && (
                      <button style={btnLink} onClick={() => setPaying(p)}>
                        Registrar pago
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.payments.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, color: colors.muted }}>Pagos registrados ({c.payments.length})</summary>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', fontSize: 13 }}>
                {c.payments.map((p) => (
                  <li key={p.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: `1px solid ${colors.border}` }}>
                    <span style={{ flex: 1 }}>
                      {formatDay(p.paidAt)} · {money(p.amount, c.currency)} ({formatPeriod(p.period)}){p.method ? ` · ${p.method}` : ''}
                      {p.authorName && <small style={{ color: colors.muted }}> · {p.authorName}</small>}
                    </span>
                    <button
                      style={{ ...btnLink, color: colors.danger, fontSize: 13 }}
                      onClick={() => window.confirm('¿Borrar este pago?') && act(() => apiFetch(`/rentals/${c.id}/payments/${p.id}`, { method: 'DELETE' }))}
                    >
                      Borrar
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <div style={{ display: 'grid', gap: 16 }}>
          <section style={card}>
            <h2 style={h2}>Partes</h2>
            <Party title="Inquilino" name={c.tenantName} phone={c.tenantPhone} email={c.tenantEmail} extra={c.tenantDocument ? `DNI/CUIT ${c.tenantDocument}` : null} />
            <Party title="Propietario" name={c.ownerName} phone={c.ownerPhone} email={c.ownerEmail} />
            <p style={{ fontSize: 13, color: colors.muted, margin: '10px 0 0' }}>
              {c.deposit ? `Depósito: ${money(c.deposit, c.currency)}. ` : ''}
              {c.adminFeePct ? `Comisión de administración: ${c.adminFeePct}%.` : ''}
            </p>
            {c.notes && <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>{c.notes}</p>}
          </section>

          <section style={card}>
            <h2 style={h2}>Ajustes aplicados</h2>
            {c.adjustments.length === 0 ? (
              <p style={{ color: colors.muted, fontSize: 14, margin: 0 }}>Todavía no hubo ajustes.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
                {c.adjustments.map((a, i) => (
                  <li key={a.id} style={{ padding: '8px 0', borderTop: i ? `1px solid ${colors.border}` : undefined }}>
                    <strong>{formatDay(a.effectiveDate)}</strong>: {money(a.previousRent, c.currency)} → {money(a.newRent, c.currency)} ({pctChange(a.factor)})
                    <br />
                    <small style={{ color: colors.muted }}>
                      {describeDetail(a.index, a.detail)}
                      {a.authorName ? ` · ${a.authorName}` : ''}
                    </small>
                    {i === 0 && (
                      <button
                        style={{ ...btnLink, fontSize: 13, marginLeft: 8 }}
                        onClick={() => window.confirm('¿Deshacer este ajuste? El alquiler vuelve al monto anterior.') && act(() => apiFetch(`/rentals/${c.id}/adjustments/last`, { method: 'DELETE' }), 'Se deshizo el ajuste')}
                      >
                        Deshacer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editing && (
        <Modal title="Editar contrato" onClose={() => setEditing(false)}>
          <RentalForm
            contract={c}
            locked={c.adjustments.length > 0}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setNotice('Se guardaron los cambios');
              load();
            }}
          />
        </Modal>
      )}
      {paying && (
        <Modal title={`Registrar pago: ${formatPeriod(paying.period)}`} onClose={() => setPaying(null)}>
          <PaymentForm
            contract={c}
            period={paying}
            onCancel={() => setPaying(null)}
            onSaved={() => {
              setPaying(null);
              setNotice('Pago registrado');
              load();
            }}
          />
        </Modal>
      )}
    </main>
  );
}

/** Próximo ajuste: calculado con el índice, para aplicar (o con lo que falta para calcularlo). */
function AdjustmentBox({ contract: c, isAdmin, onDone, onError }: { contract: ContractDetail; isAdmin: boolean; onDone: (msg: string) => void; onError: (m: string) => void }) {
  const adj = c.nextAdjustment;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setAmount(adj?.ok ? String(adj.newRent) : ''), [adj?.date, adj?.ok]);
  if (!adj) return null;

  async function apply(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(/\./g, '').replace(',', '.'));
    if (!value || value <= 0) return onError('Ingresá el nuevo monto');
    setBusy(true);
    try {
      await apiFetch(`/rentals/${c.id}/adjustments`, { method: 'POST', body: JSON.stringify(adj?.ok && value === adj.newRent ? {} : { newRent: value }) });
      onDone(`Ajuste aplicado: desde el ${formatDay(adj!.date)} el alquiler es ${money(value, c.currency)}. Avisale a ${c.tenantName}.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const missingIndex = adj.canApply && !adj.ok && /(ICL|IPC)/.test(adj.reason);
  return (
    <section style={{ ...card, marginBottom: 16, borderColor: adj.canApply ? '#b197fc' : colors.border, background: adj.canApply ? '#f8f5ff' : '#fff' }}>
      <h2 style={h2}>Próximo ajuste: {formatDay(adj.date)}</h2>
      {adj.ok ? (
        <p style={{ margin: '0 0 10px', fontSize: 15 }}>
          Pasa de <strong>{money(c.currentRent, c.currency)}</strong> a <strong>{money(adj.newRent, c.currency)}</strong> ({pctChange(adj.factor)}).
          <br />
          <small style={{ color: colors.muted }}>{describeDetail(c.adjustmentIndex, adj.detail)}</small>
        </p>
      ) : adj.canApply ? (
        <p style={{ margin: '0 0 10px', fontSize: 14, color: '#c2410c' }}>{adj.reason}.</p>
      ) : (
        <p style={{ margin: '0 0 10px', fontSize: 14, color: colors.muted }}>
          {c.adjustmentIndex === 'ninguno' ? 'Sin índice: el monto se pacta a mano.' : 'Se calcula cuando estén publicados los índices de esa fecha.'}
        </p>
      )}
      {adj.canApply ? (
        <form onSubmit={apply} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 14 }}>
            Nuevo alquiler{' '}
            <input style={{ ...input, display: 'inline-block', width: 160 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Nuevo alquiler" />
          </label>
          <button type="submit" style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
            {busy ? 'Aplicando…' : 'Aplicar ajuste'}
          </button>
          <small style={{ color: colors.muted }}>{adj.ok ? 'Podés corregir el monto si pactaron otro redondeo.' : 'Ingresá el monto pactado.'}</small>
        </form>
      ) : (
        <small style={{ color: colors.muted }}>Se va a poder aplicar desde 30 días antes; te avisamos en la campana.</small>
      )}
      {missingIndex && isAdmin && <ManualIndex onSaved={() => onDone('Se cargó el valor del índice')} onError={onError} defaultIndex={c.adjustmentIndex === 'icl' ? 'icl' : 'ipc'} />}
      {missingIndex && !isAdmin && <small style={{ display: 'block', color: colors.muted, marginTop: 8 }}>Un administrador puede cargar a mano el valor que falta.</small>}
    </section>
  );
}

function ManualIndex({ defaultIndex, onSaved, onError }: { defaultIndex: 'icl' | 'ipc'; onSaved: () => void; onError: (m: string) => void }) {
  const [index, setIndex] = useState(defaultIndex);
  const [date, setDate] = useState(todayAr().slice(0, index === 'ipc' ? 7 : 10));
  const [value, setValue] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/rentals/indexes', {
        method: 'POST',
        body: JSON.stringify({ index, date: index === 'ipc' ? `${date.slice(0, 7)}-01` : date, value: Number(value.replace(/\./g, '').replace(',', '.')) }),
      });
      setValue('');
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    }
  }
  return (
    <form onSubmit={save} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${colors.border}` }}>
      <strong style={{ fontSize: 13 }}>Cargar a mano:</strong>
      <select style={{ ...input, width: 90, padding: '6px 8px' }} value={index} onChange={(e) => setIndex(e.target.value as 'icl' | 'ipc')} aria-label="Índice">
        <option value="ipc">IPC</option>
        <option value="icl">ICL</option>
      </select>
      <input
        style={{ ...input, width: 160, padding: '6px 8px' }}
        type={index === 'ipc' ? 'month' : 'date'}
        value={index === 'ipc' ? date.slice(0, 7) : date.length === 7 ? `${date}-01` : date}
        onChange={(e) => setDate(e.target.value)}
        aria-label={index === 'ipc' ? 'Mes' : 'Día'}
      />
      <input style={{ ...input, width: 130, padding: '6px 8px' }} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={index === 'ipc' ? 'Ej. 12345,67' : 'Ej. 36,86'} aria-label="Valor" />
      <button type="submit" style={{ ...btnSecondary, padding: '6px 12px' }}>
        Guardar
      </button>
      <small style={{ color: colors.muted, width: '100%' }}>
        {index === 'ipc' ? 'IPC nivel general nacional (base dic. 2016 = 100), del informe del INDEC.' : 'ICL del día, de la página del BCRA.'}
      </small>
    </form>
  );
}

function PaymentForm({ contract: c, period, onSaved, onCancel }: { contract: ContractDetail; period: PeriodStatus; onSaved: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(period.balance));
  const [paidAt, setPaidAt] = useState(todayAr());
  const [method, setMethod] = useState('Transferencia');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/rentals/${c.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ period: period.period, amount: Number(amount.replace(/\./g, '').replace(',', '.')), paidAt, method, notes }),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label>
          <span style={lbl}>Monto ({c.currency === 'USD' ? 'US$' : '$'})</span>
          <input style={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <small style={{ color: colors.muted }}>Alquiler del mes: {money(period.due, c.currency)}{period.paid ? ` · ya pagó ${money(period.paid, c.currency)}` : ''}</small>
        </label>
        <label>
          <span style={lbl}>Fecha de pago</span>
          <input style={input} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
        <label>
          <span style={lbl}>Forma de pago</span>
          <select style={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {['Transferencia', 'Efectivo', 'Depósito', 'Cheque', 'Otro'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span style={lbl}>Notas</span>
          <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      <div style={footer}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnLink} onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
          {busy ? 'Guardando…' : 'Registrar pago'}
        </button>
      </div>
    </form>
  );
}

/** Últimos valores de ICL e IPC, y de cuándo son. */
function IndexesCard({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<{ icl: IndexValue[]; ipc: IndexValue[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => apiFetch<{ icl: IndexValue[]; ipc: IndexValue[] }>('/rentals/indexes').then(setData).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  async function sync() {
    setSyncing(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ icl: number; ipc: number; errors: string[] }>('/rentals/indexes/sync', { method: 'POST' });
      setMsg(r.errors.length ? `No se pudo actualizar todo: ${r.errors.join(' · ')}` : 'Índices actualizados');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const icl = data?.icl[0];
  const ipc = data?.ipc[0];
  return (
    <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
      <span>
        <strong>ICL</strong> {icl ? `${icl.value.toLocaleString('es-AR')} (${formatDay(icl.date)})` : 'sin datos todavía'}
      </span>
      <span>
        <strong>IPC</strong> {ipc ? `${formatPeriod(ipc.date)}${ipc.source === 'manual' ? ' (cargado a mano)' : ''}` : 'sin datos todavía'}
      </span>
      <small style={{ color: colors.muted }}>Se actualizan solos todos los días (BCRA e INDEC).</small>
      {isAdmin && (
        <button style={{ ...btnLink, marginLeft: 'auto' }} onClick={sync} disabled={syncing}>
          {syncing ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      )}
      {msg && <small style={{ width: '100%', color: msg.startsWith('Índices') ? '#2b8a3e' : colors.danger }}>{msg}</small>}
    </div>
  );
}

function describeDetail(index: string, d?: Record<string, any> | null): string {
  if (!d) return '';
  if (d.manual && d.calculated) return `Monto pactado a mano (el índice daba ${money(d.calculated)})`;
  if (d.manual) return 'Monto pactado a mano';
  if (index === 'icl' && d.from) return `ICL ${num(d.from.value)} (${formatDay(d.from.date)}) → ${num(d.to.value)} (${formatDay(d.to.date)})`;
  if (index === 'ipc' && d.from) return `IPC ${formatPeriod(d.from.month)} → ${formatPeriod(d.to.month)} (${d.months} meses)`;
  if (index === 'fijo' && d.pct != null) return `${d.pct}% fijo pactado`;
  return '';
}
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 4 });

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 13, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: danger ? colors.danger : undefined, margin: '4px 0' }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: colors.muted }}>{sub}</div>}
    </div>
  );
}

function Party({ title, name, phone, email, extra }: { title: string; name: string; phone?: string | null; email?: string | null; extra?: string | null }) {
  const wa = phone?.replace(/[^\d]/g, '');
  return (
    <div style={{ fontSize: 14, marginBottom: 10 }}>
      <span style={{ color: colors.muted, fontSize: 12 }}>{title}</span>
      <div>
        <strong>{name}</strong>
        {extra ? <small style={{ color: colors.muted }}> · {extra}</small> : null}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
            WhatsApp {phone}
          </a>
        )}
        {email && <a href={`mailto:${email}`}>{email}</a>}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: ContractStatus }) {
  const s = CONTRACT_STATUSES.find((x) => x.value === status)!;
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 500 }}>{s.label}</span>;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const page: CSSProperties = { fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 };
const th: CSSProperties = { padding: '12px 16px', fontWeight: 500 };
const td: CSSProperties = { padding: '12px 16px', verticalAlign: 'top' };
const th2: CSSProperties = { padding: '6px 6px 6px 0', fontWeight: 500, fontSize: 13 };
const td2: CSSProperties = { padding: '8px 6px 8px 0' };
const h2: CSSProperties = { fontSize: 16, margin: '0 0 12px' };
const lbl: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: `1px solid ${colors.border}` };

