/**
 * Pasa los archivos guardados en disco a S3/R2 y actualiza las URLs de las fotos en la base.
 *
 *   npm run storage:to-s3 -w apps/api -- --dry-run   # muestra qué haría, sin cambiar nada
 *   npm run storage:to-s3 -w apps/api                # lo hace
 *
 * Usa las mismas variables que la API (DATABASE_URL, UPLOAD_DIR, S3_*). Se puede correr más de una vez:
 * lo que ya está en el bucket no se vuelve a subir y las URLs ya migradas no se tocan.
 * Recién después de correrlo conviene poner STORAGE_DRIVER=s3 y reiniciar la API.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import dataSource from '../data-source';
import { PHOTO_FILE_NAME, UPLOADS_ROUTE, uploadsDir } from '../modules/media/infrastructure/local-photo.storage';
import { S3Bucket, s3SettingsFromEnv } from '../shared/infrastructure/s3-bucket';

const CHAT_FILE = /^[0-9a-f-]{36}\.(jpg|ogg|mp3|m4a|amr|aac|bin)$/;
const CHAT_TYPES: Record<string, string> = { jpg: 'image/jpeg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', amr: 'audio/amr', aac: 'audio/aac' };
/** Tablas con URLs de fotos (las mismas que revisa la limpieza de huérfanas). */
const URL_COLUMNS = [
  ['properties', 'photo_urls'],
  ['social_posts', 'media_urls'],
] as const;

function env(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Falta ${key}`);
  return value;
}

async function localFiles(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => pattern.test(n));
  } catch {
    return []; // la carpeta no existe: no hay nada que migrar
  }
}

async function copyFolder(bucket: S3Bucket, dir: string, prefix: string, pattern: RegExp, type: (name: string) => string, cache: string | undefined, dryRun: boolean) {
  const names = await localFiles(dir, pattern);
  const already = new Set((await bucket.list(prefix)).map((o) => o.key.slice(prefix.length)));
  const pending = names.filter((n) => !already.has(n));
  if (!dryRun) for (const n of pending) await bucket.put(prefix + n, await readFile(join(dir, n)), type(n), cache);
  console.log(`  ${prefix.padEnd(12)} en disco: ${names.length} · ya en el bucket: ${names.length - pending.length} · ${dryRun ? 'a subir' : 'subidos'}: ${pending.length}`);
  return new Set([...already, ...pending]);
}

/** "http://localhost:3000/uploads/photos/<uuid>.jpg" -> "<uuid>.jpg" (se mira solo la ruta: el host pudo cambiar). */
function localPhotoName(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const prefix = `${UPLOADS_ROUTE}/photos/`;
    const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
    return PHOTO_FILE_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const settings = s3SettingsFromEnv((k) => process.env[k]);
  const publicBucket = new S3Bucket(settings, env('S3_PUBLIC_BUCKET'));
  const privateBucket = new S3Bucket(settings, env('S3_PRIVATE_BUCKET'));
  const publicUrl = env('S3_PUBLIC_URL').replace(/\/+$/, '');
  console.log(dryRun ? 'Simulación (--dry-run): no se cambia nada.\n' : 'Migrando a S3/R2...\n');

  console.log('Archivos:');
  const photosInBucket = await copyFolder(publicBucket, join(uploadsDir(), 'photos'), 'photos/', PHOTO_FILE_NAME, () => 'image/jpeg', 'public, max-age=31536000, immutable', dryRun);
  await copyFolder(privateBucket, join(uploadsDir(), 'chat-media'), 'chat-media/', CHAT_FILE, (n) => CHAT_TYPES[n.split('.').pop()!] ?? 'application/octet-stream', undefined, dryRun);

  console.log('\nURLs de fotos en la base:');
  await dataSource.initialize();
  try {
    for (const [table, column] of URL_COLUMNS) {
      const rows: { id: string; urls: string[] }[] = await dataSource.query(`SELECT id, "${column}" AS urls FROM "${table}"`);
      let changedRows = 0;
      let missing = 0;
      for (const row of rows) {
        const next = row.urls.map((url) => {
          const name = localPhotoName(url);
          if (!name) return url; // link externo o ya migrado
          if (!photosInBucket.has(name)) {
            missing++; // la base apunta a un archivo que no está en disco: se deja como está para revisarlo
            return url;
          }
          return `${publicUrl}/photos/${name}`;
        });
        if (next.some((u, i) => u !== row.urls[i])) {
          changedRows++;
          if (!dryRun) await dataSource.query(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, [JSON.stringify(next), row.id]);
        }
      }
      console.log(`  ${`${table}.${column}`.padEnd(24)} filas ${dryRun ? 'a actualizar' : 'actualizadas'}: ${changedRows}${missing ? ` · URLs sin archivo en disco: ${missing}` : ''}`);
    }
  } finally {
    await dataSource.destroy();
  }
  console.log(dryRun ? '\nListo (simulación). Corrélo sin --dry-run para aplicar.' : '\nListo. Ahora poné STORAGE_DRIVER=s3 y reiniciá la API.');
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exit(1);
});
