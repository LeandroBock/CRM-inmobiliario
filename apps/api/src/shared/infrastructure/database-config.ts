import type { TlsOptions } from 'node:tls';

export interface DatabaseConnection {
  url: string;
  ssl?: TlsOptions;
  extra?: { max: number };
}

/**
 * Conexión a PostgreSQL a partir de las variables de entorno (la usan la API y el CLI de migraciones).
 *
 * - DATABASE_SSL=true: conexión cifrada, obligatoria en bases en la nube (Supabase, Neon, Render...).
 *   Con DATABASE_CA_CERT (el certificado de la base, en texto PEM) además se verifica que el servidor sea el real.
 * - DATABASE_POOL_MAX: conexiones simultáneas (10 por defecto). En Supabase gratis conviene 5: su pooler admite
 *   pocas y durante un deploy conviven la versión vieja y la nueva de la API.
 */
export function databaseConnection(get: (key: string) => string | undefined): DatabaseConnection {
  const raw = get('DATABASE_URL')?.trim();
  if (!raw) throw new Error('Falta DATABASE_URL');

  const conn: DatabaseConnection = { url: raw };
  if (get('DATABASE_SSL') === 'true') {
    // Los parámetros sslmode/ssl de la URL pisarían esta configuración (y en pg reciente "require" exige
    // verificar el certificado contra las CA del sistema, que no incluyen la de Supabase): se quitan.
    const url = new URL(raw);
    for (const p of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(p);
    conn.url = url.toString();
    const ca = get('DATABASE_CA_CERT')?.replace(/\\n/g, '\n').trim();
    conn.ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  const max = Number(get('DATABASE_POOL_MAX'));
  if (Number.isInteger(max) && max > 0) conn.extra = { max };
  return conn;
}
