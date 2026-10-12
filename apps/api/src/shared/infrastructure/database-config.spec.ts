import { databaseConnection } from './database-config';

const from = (env: Record<string, string>) => databaseConnection((k) => env[k]);

describe('databaseConnection', () => {
  it('local (Docker): la URL tal cual, sin SSL', () => {
    expect(from({ DATABASE_URL: 'postgres://crm:crm@localhost:5433/crm' })).toEqual({ url: 'postgres://crm:crm@localhost:5433/crm' });
  });

  it('Supabase: SSL activado y sin los parámetros sslmode de la URL (los pisarían)', () => {
    const conn = from({
      DATABASE_URL: 'postgresql://postgres.abc:clave@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require',
      DATABASE_SSL: 'true',
    });
    expect(conn.url).toBe('postgresql://postgres.abc:clave@aws-0-sa-east-1.pooler.supabase.com:5432/postgres');
    expect(conn.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('con el certificado de la base, se verifica el servidor (acepta el PEM pegado en una sola línea con \\n)', () => {
    const conn = from({ DATABASE_URL: 'postgres://u:p@h/db', DATABASE_SSL: 'true', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----' });
    expect(conn.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----', rejectUnauthorized: true });
  });

  it('contraseñas con caracteres especiales sobreviven a la limpieza de la URL', () => {
    const conn = from({ DATABASE_URL: 'postgres://u:p%40ss%2Fw0rd@h:5432/db?sslmode=require&application_name=crm', DATABASE_SSL: 'true' });
    expect(conn.url).toBe('postgres://u:p%40ss%2Fw0rd@h:5432/db?application_name=crm');
  });

  it('tope de conexiones', () => {
    expect(from({ DATABASE_URL: 'postgres://u:p@h/db', DATABASE_POOL_MAX: '5' }).extra).toEqual({ max: 5 });
    expect(from({ DATABASE_URL: 'postgres://u:p@h/db', DATABASE_POOL_MAX: 'muchas' }).extra).toBeUndefined();
  });

  it('sin DATABASE_URL lo dice', () => {
    expect(() => from({})).toThrow('Falta DATABASE_URL');
  });
});
