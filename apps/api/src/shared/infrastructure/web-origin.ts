/** WEB_ORIGIN puede traer varios orígenes separados por coma (CORS). Los links de emails y redirecciones usan el primero. */
export function webOrigins(value: string | undefined): string[] {
  const list = (value ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return list.length ? list : ['http://localhost:5173'];
}

export const primaryWebOrigin = (value: string | undefined) => webOrigins(value)[0];
