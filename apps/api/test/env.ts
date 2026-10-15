import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Variables para los tests. La API no lee el .env con NODE_ENV=test (ver app.module.ts), así que solo existe
 * lo que se define acá: sin claves de WhatsApp, SMTP, Google ni Claude, nunca sale nada a servicios reales.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://crm:crm@localhost:5433/crm_test';

// La terminal puede traer claves reales (p. ej. después de `source apps/api/.env.storage`): se descartan todas las de
// servicios externos, así un test nunca sube archivos, manda mensajes ni borra nada fuera de la máquina.
// Se conservan solo las de la base de prueba (TEST_DATABASE_URL, DATABASE_SSL, DATABASE_POOL_MAX, DATABASE_CA_CERT).
const OUTSIDE = /^(S3_|STORAGE_|UPLOAD_DIR|WHATSAPP_|GOOGLE_|SMTP_|ANTHROPIC_|OPENAI_|LLM_|CONTENT_LLM_|CLOUDFLARE_|IMAGE_AI_|TRANSCRIBE_|TOKEN_ENCRYPTION_KEY|META_|LINKEDIN_|TIKTOK_|AVM_|ADMIN_|JWT_|PUBLIC_URL|WEB_ORIGIN|RENDER_|TRUST_PROXY|AUTO_ASSIGN_LEADS|DB_SYNC|DATABASE_URL$)/;
for (const key of Object.keys(process.env)) if (OUTSIDE.test(key)) delete process.env[key];

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  DB_SYNC: 'true',
  JWT_SECRET: 'secreto-solo-para-tests-0123456789abcdefghijklmnop',
  WEB_ORIGIN: 'http://localhost:5173',
  PUBLIC_URL: 'http://localhost:3000',
  AVM_SERVICE_URL: 'http://127.0.0.1:9', // nadie escucha ahí: los tests no dependen del tasador
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-de-prueba',
  // Sin espera antes de contestar (los tests que prueban el agrupado de mensajes la cambian)
  WHATSAPP_REPLY_DELAY_MS: '0',
  STORAGE_DRIVER: 'local',
  // Fotos a una carpeta temporal: nunca a apps/api/uploads.
  UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'crm-test-uploads-')),
});
