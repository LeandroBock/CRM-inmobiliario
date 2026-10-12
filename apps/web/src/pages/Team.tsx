import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../api/client';
import { timeAgo } from '../api/leads';
import { getTeam } from '../api/team';
import { btnLink, btnPrimary, btnSecondary, card, colors, input } from '../styles';

/** Mismo mínimo que la API (auth.dto.ts). */
const PASSWORD_MIN = 10;

interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'agent';
  isActive: boolean;
  lastLoginAt?: string | null;
}

const ROLES = [
  { value: 'agent', label: 'Asesor' },
  { value: 'admin', label: 'Administrador' },
] as const;

/** Gestión de usuarios (solo admins; la API también lo exige). */
export default function Team({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<User[]>('/users')
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function update(user: User, changes: Partial<User> & { password?: string }, message: string) {
    setError(null);
    try {
      const saved = await apiFetch<User>(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
      setUsers((prev) => prev?.map((u) => (u.id === saved.id ? saved : u)) ?? prev);
      setNotice(message);
      void getTeam(true).catch(() => undefined); // los selectores de asesor se actualizan
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Equipo</h1>
        {!creating && (
          <button style={btnPrimary} onClick={() => setCreating(true)}>
            + Nuevo usuario
          </button>
        )}
      </header>
      <p style={{ color: colors.muted, fontSize: 14, marginTop: 0 }}>
        Los leads que entran por WhatsApp se reparten entre los asesores activos (al que tenga menos leads abiertos). Si no hay asesores,
        van a un administrador. Desactivar a alguien le corta el acceso al instante; sus leads siguen a su nombre hasta que los reasignes.
      </p>

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

      {creating && (
        <NewUserForm
          onCancel={() => setCreating(false)}
          onCreated={(u) => {
            setUsers((prev) => [...(prev ?? []), u]);
            setCreating(false);
            setNotice(`Se creó a ${u.fullName}. Pasale su email y la contraseña por un canal seguro; la puede cambiar después.`);
            void getTeam(true).catch(() => undefined);
          }}
        />
      )}

      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted }}>
              <th style={th}>Usuario</th>
              <th style={th}>Rol</th>
              <th style={th}>Estado</th>
              <th style={th}>Último acceso</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {users === null && !error && (
              <tr>
                <td style={td} colSpan={5}>
                  Cargando…
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const self = u.id === currentUserId;
              return (
                <tr key={u.id} style={{ borderTop: `1px solid ${colors.border}`, opacity: u.isActive ? 1 : 0.6 }}>
                  <td style={td}>
                    <strong>{u.fullName}</strong> {self && <small style={{ color: colors.muted }}>(vos)</small>}
                    <br />
                    <small style={{ color: colors.muted }}>{u.email}</small>
                  </td>
                  <td style={td}>
                    <select
                      style={{ ...input, width: 160, padding: '5px 8px', fontSize: 14 }}
                      value={u.role}
                      disabled={self}
                      title={self ? 'No podés cambiarte el rol a vos mismo' : undefined}
                      onChange={(e) => update(u, { role: e.target.value as User['role'] }, `${u.fullName} ahora es ${labelRole(e.target.value)}`)}
                      aria-label={`Rol de ${u.fullName}`}
                    >
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: self ? 'default' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={u.isActive}
                        disabled={self}
                        onChange={(e) =>
                          update(u, { isActive: e.target.checked }, e.target.checked ? `${u.fullName} está activo de nuevo` : `${u.fullName} ya no puede entrar`)
                        }
                      />
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </label>
                  </td>
                  <td style={{ ...td, color: colors.muted, whiteSpace: 'nowrap' }}>{timeAgo(u.lastLoginAt)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {resetting === u.id ? (
                      <PasswordReset
                        onCancel={() => setResetting(null)}
                        onSave={async (password) => {
                          if (await update(u, { password }, `Se cambió la contraseña de ${u.fullName}. Sus sesiones abiertas se cerraron.`)) setResetting(null);
                        }}
                      />
                    ) : (
                      <button style={btnLink} onClick={() => setResetting(u.id)}>
                        Cambiar contraseña
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function labelRole(value: string) {
  return ROLES.find((r) => r.value === value)?.label.toLowerCase() ?? value;
}

function NewUserForm({ onCreated, onCancel }: { onCreated: (u: User) => void; onCancel: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>('agent');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) return setError('Completá el nombre');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('El email no es válido');
    if (password.length < PASSWORD_MIN) return setError(`La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`);
    setSaving(true);
    setError(null);
    try {
      onCreated(await apiFetch<User>('/users', { method: 'POST', body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), password, role }) }));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ ...card, marginBottom: 16, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Nuevo usuario</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label style={label}>
          Nombre y apellido
          <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </label>
        <label style={label}>
          Email
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label style={label}>
          Contraseña inicial
          <input style={input} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <small style={{ fontWeight: 400, color: colors.muted }}>Mínimo {PASSWORD_MIN} caracteres.</small>
        </label>
        <label style={label}>
          Rol
          <select style={input} value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span role="alert" style={{ color: colors.danger, fontSize: 14, flex: 1 }}>
          {error}
        </span>
        <button type="button" style={btnSecondary} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }} disabled={saving}>
          {saving ? 'Creando…' : 'Crear usuario'}
        </button>
      </div>
    </form>
  );
}

function PasswordReset({ onSave, onCancel }: { onSave: (password: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const short = value.length < PASSWORD_MIN;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <input
        style={{ ...input, width: 180, padding: '5px 8px', fontSize: 14 }}
        type="text"
        autoComplete="new-password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Nueva (mín. ${PASSWORD_MIN})`}
        aria-label="Nueva contraseña"
        autoFocus
      />
      <button style={{ ...btnSecondary, padding: '5px 10px', opacity: short ? 0.6 : 1 }} disabled={short} onClick={() => onSave(value)}>
        Guardar
      </button>
      <button style={btnLink} onClick={onCancel}>
        Cancelar
      </button>
    </span>
  );
}

const th: CSSProperties = { padding: '12px 16px', fontWeight: 500 };
const td: CSSProperties = { padding: '12px 16px', verticalAlign: 'middle' };
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 13, fontWeight: 500 };
const banner: CSSProperties = { border: '1px solid', borderRadius: 8, padding: '10px 14px', fontSize: 14, margin: '0 0 16px' };
