import { useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch, tokenStore } from '../api/client';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'agent';
}

interface Props {
  onLogin: (user: SessionUser) => void;
}

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ accessToken: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      tokenStore.set(res.accessToken);
      onLogin(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>CRM Cognitivo</h1>
        <p style={{ margin: '0 0 20px', color: '#667' }}>Ingresá con tu cuenta</p>

        <label style={label}>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
          />
        </label>
        <label style={label}>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: '#c92a2a', fontSize: 14, margin: '0 0 12px' }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} style={{ ...button, opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}

const card: CSSProperties = {
  width: 340,
  background: '#fff',
  border: '1px solid #e3e7ef',
  borderRadius: 12,
  padding: 28,
};
const label: CSSProperties = { display: 'block', fontSize: 14, marginBottom: 14 };
const input: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 12px',
  border: '1px solid #cfd6e4',
  borderRadius: 8,
  fontSize: 15,
};
const button: CSSProperties = {
  width: '100%',
  padding: '11px 0',
  border: 0,
  borderRadius: 8,
  background: '#2f5bea',
  color: '#fff',
  fontSize: 15,
  cursor: 'pointer',
};
