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
export async function apiFetchBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  return (await request(path, init)).blob();
}

/**
 * Sube un archivo informando el avance (0 a 1). fetch no da progreso de subida, por eso XMLHttpRequest.
 * Para videos: pueden ser decenas de MB y conviene mostrar cuánto falta.
 */
export function uploadWithProgress<T>(path: string, file: File, field: string, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}${path}`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Se cortó la conexión mientras se subía el archivo'));
    xhr.onload = () => {
      let body: { message?: string | string[] } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* sin JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      if (xhr.status === 401 && token) {
        tokenStore.clear();
        window.dispatchEvent(new Event(AUTH_EVENT));
      }
      if (xhr.status === 413) return reject(new Error('El archivo es demasiado grande'));
      const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      reject(new Error(msg ?? `Error ${xhr.status}`));
    };
    const form = new FormData();
    form.append(field, file);
    xhr.send(form);
  });
}
