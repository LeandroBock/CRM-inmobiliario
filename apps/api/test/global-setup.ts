import { Client } from 'pg';
import { databaseConnection } from '../src/shared/infrastructure/database-config';
import { TEST_DATABASE_URL } from './env';

/** Crea la base de prueba (una sola vez) con las extensiones que usa el esquema. */
export default async function globalSetup() {
  // Misma conexión que la API (DATABASE_SSL, etc.), así también se puede probar contra una base que exige SSL.
  const conn = databaseConnection((k) => (k === 'DATABASE_URL' ? TEST_DATABASE_URL : process.env[k]));
  const url = new URL(conn.url);
  const dbName = url.pathname.slice(1);
  // Los tests vacían todas las tablas: nunca correrlos contra una base que no sea de prueba.
  if (!dbName.endsWith('_test')) throw new Error(`TEST_DATABASE_URL tiene que apuntar a una base *_test (es "${dbName}")`);

  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString(), ssl: conn.ssl });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`No hay conexión con PostgreSQL (${url.host}). Levantá la base: docker compose up -d db\n${(err as Error).message}`);
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const db = new Client({ connectionString: conn.url, ssl: conn.ssl });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await db.end();
}
