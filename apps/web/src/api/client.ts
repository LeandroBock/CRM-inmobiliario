const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'crm_token';

/** Se dispara cuando la API responde 401 con una sesión activa (token vencido o revocado). */
export const AUTH_EVENT = 'crm:unauthorized';

/**
 * El token se guarda en localStorage: simple y sobrevive a recargas, pero un XSS podría leerlo.
 * Mitigaciones: vence a las 8 h, no hay HTML inyectado en el panel y conviene sumar CSP al servir.
 * Alternativa más estricta: cookie httpOnly + protección CSRF (requiere ajustar CORS y la API).
 */
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* sin storage: la sesión dura hasta recargar */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nada */
    }
  },
};

/** Hace el request con el token y convierte los errores de la API en Error con un mensaje legible. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  // Con FormData (subida de archivos) el navegador arma el Content-Type multipart con su boundary.
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API}${path}`, { ...init, headers });

  if (res.status === 401 && token) {
    tokenStore.clear();
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error('Demasiados intentos. Esperá un minuto y probá de nuevo.');
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(message);
  }
  return res;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Archivos que requieren sesión (audios y fotos de clientes): no se pueden pedir con un <img src> común. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  return (await request(path)).blob();
}
