/**
 * Verifica la configuración de S3 / Cloudflare R2 antes de usarla (STORAGE_DRIVER=s3). No toca nada del CRM:
 * sube un archivo de prueba a cada bucket, revisa que se pueda leer (y ver desde internet el público), y lo borra.
 *
 *   npm run storage:check -w apps/api                                   # en tu máquina (lee apps/api/.env)
 *   docker compose -f docker-compose.prod.yml exec api node dist/scripts/check-storage.js   # en el servidor
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { S3Bucket, s3SettingsFromEnv } from '../shared/infrastructure/s3-bucket';

try {
  process.loadEnvFile(join(__dirname, '..', '..', '.env')); // no pisa variables ya definidas (Docker)
} catch {
  // sin .env: variables del sistema
}

/** JPG de 1×1 px: lo mínimo para que el navegador lo muestre como imagen. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////' +
    'wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
  'base64',
);

let failures = 0;
const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const fail = (msg: string, hint?: string) => {
  failures += 1;
  console.log(`  ✘ ${msg}${hint ? `\n      → ${hint}` : ''}`);
};
const warn = (msg: string) => console.log(`  ! ${msg}`);

/** Traduce los errores típicos de S3/R2 a qué revisar. */
function explain(err: unknown, bucket: string): string {
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string } };
  const code = e.name ?? e.code ?? '';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized/i.test(code)) {
    return 'La clave no es válida: revisá S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY (copialas de nuevo, sin espacios).';
  }
  if (/NoSuchBucket/i.test(code)) return `No existe un bucket llamado "${bucket}" en esa cuenta: revisá el nombre (y S3_ENDPOINT, que es de la cuenta).`;
  if (/AccessDenied|Forbidden/i.test(code)) {
    return `La clave no tiene permiso sobre "${bucket}". En R2: el API token tiene que ser "Object Read & Write" e incluir este bucket.`;
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(e.cause?.code ?? e.code ?? e.message ?? '')) {
    return 'No se encuentra el servidor: revisá S3_ENDPOINT (R2: https://<id-de-cuenta>.r2.cloudflarestorage.com, sin el nombre del bucket).';
  }
  return `${code || 'Error'}: ${e.message ?? String(err)}`;
}

async function step<T>(label: string, bucket: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    ok(label);
    return result;
  } catch (err) {
    fail(label, explain(err, bucket));
    return undefined;
  }
}

async function checkBucket(bucket: S3Bucket, prefix: string, contentType: string, body: Buffer, publicUrl?: string): Promise<void> {
  const key = `${prefix}crm-check-${randomUUID()}${contentType === 'image/jpeg' ? '.jpg' : '.bin'}`;
  const put = await step(`Subir un archivo de prueba a "${bucket.name}"`, bucket.name, () =>
    bucket.put(key, body, contentType, publicUrl ? 'public, max-age=60' : undefined).then(() => true),
  );
  if (!put) return; // sin subida no hay nada más que probar

  try {
    await step('Leerlo de vuelta', bucket.name, async () => {
      const data = await bucket.get(key);
      if (!data?.equals(body)) throw new Error('El archivo leído no coincide con el subido');
      return true;
    });
    await step('Listar archivos (lo usa la limpieza nocturna)', bucket.name, async () => {
      const keys = (await bucket.list(prefix)).map((o) => o.key);
      if (!keys.includes(key)) throw new Error('El archivo subido no aparece en el listado');
    });

    if (publicUrl) {
      const url = `${publicUrl}/${key}`;
      try {
        const res = await fetch(url);
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.startsWith('image/jpeg')) ok(`Se ve desde internet sin clave: ${url}`);
        else
          fail(
            `La foto no se ve desde internet (${res.status} ${type || 'sin tipo'}): ${url}`,
            'En R2: abrí el bucket público → Settings → Public access y activá el dominio r2.dev (o conectá un dominio propio). ' +
              'Después copiá esa URL en S3_PUBLIC_URL, sin barra al final.',
          );
      } catch (err) {
        fail(`No se pudo abrir ${url}`, `Revisá S3_PUBLIC_URL (${(err as Error).message}).`);
      }
    }
  } finally {
    await step('Borrar el archivo de prueba', bucket.name, async () => {
      await bucket.delete(key);
      if (await bucket.get(key)) throw new Error('El archivo sigue estando después de borrarlo');
    });
  }
}

async function main() {
  const get = (k: string) => process.env[k]?.trim() || undefined;
  console.log('\nVerificación de almacenamiento S3 / R2\n');

  console.log('Configuración');
  const missing = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BUCKET', 'S3_PUBLIC_URL', 'S3_PRIVATE_BUCKET'].filter((k) => !get(k));
  if (missing.length) {
    fail(`Faltan variables: ${missing.join(', ')}`, 'Ver apps/api/.env.example y README > Archivos en S3/R2.');
    return;
  }
  ok('Están todas las variables S3_*');
  if (get('STORAGE_DRIVER') !== 's3') warn('STORAGE_DRIVER no es "s3": la API sigue guardando en disco hasta que lo cambies (y la reinicies).');

  const publicBucket = get('S3_PUBLIC_BUCKET')!;
  const privateBucket = get('S3_PRIVATE_BUCKET')!;
  const publicUrl = get('S3_PUBLIC_URL')!.replace(/\/+$/, '');
  const endpoint = get('S3_ENDPOINT');
  if (publicBucket === privateBucket) {
    fail('S3_PUBLIC_BUCKET y S3_PRIVATE_BUCKET son el mismo bucket', 'Tienen que ser dos: los audios y fotos de clientes no pueden quedar públicos.');
  }
  if (endpoint && (endpoint.includes(`/${publicBucket}`) || endpoint.includes(`/${privateBucket}`))) {
    fail('S3_ENDPOINT incluye el nombre de un bucket', 'Va solo la dirección de la cuenta: https://<id-de-cuenta>.r2.cloudflarestorage.com');
  }
  if (!/^https:\/\//.test(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl)) {
    fail(`S3_PUBLIC_URL no es https: ${publicUrl}`, 'Las redes sociales y los navegadores necesitan https.');
  }
  if (endpoint?.includes('r2.cloudflarestorage.com') && publicUrl.startsWith(endpoint.replace(/\/+$/, ''))) {
    fail('S3_PUBLIC_URL es la dirección de la API de R2, no la pública', 'Usá la URL de "Public access" del bucket (r2.dev o tu dominio).');
  }

  const settings = s3SettingsFromEnv(get);

  console.log(`\nBucket público (fotos de propiedades): ${publicBucket}`);
  await checkBucket(new S3Bucket(settings, publicBucket), 'photos/', 'image/jpeg', TINY_JPEG, publicUrl);

  console.log(`\nBucket privado (audios y fotos de clientes): ${privateBucket}`);
  await checkBucket(new S3Bucket(settings, privateBucket), 'chat-media/', 'application/octet-stream', Buffer.from(`prueba ${randomUUID()}`));
  if (!endpoint) {
    // AWS: la dirección pública del bucket es conocida, se puede comprobar que no responda sin clave.
    const region = get('S3_REGION') ?? 'us-east-1';
    const res = await fetch(`https://${privateBucket}.s3.${region}.amazonaws.com/chat-media/`).catch(() => null);
    if (res && res.status !== 403) fail('El bucket privado responde sin clave', 'Activá "Block all public access" en el bucket.');
    else ok('El bucket privado no responde sin clave');
  } else {
    warn('Confirmá a mano en Cloudflare que el bucket privado tenga Public access DESACTIVADO (r2.dev apagado y sin dominio).');
  }

  console.log(failures ? `\n✘ ${failures} problema(s). Corregí lo marcado y volvé a correr la verificación.\n` : '\n✔ Todo bien: ya podés poner STORAGE_DRIVER=s3 (si hay archivos en disco, antes: npm run storage:to-s3).\n');
}

main()
  .catch((err) => {
    failures += 1;
    console.error(`\n✘ Error inesperado: ${(err as Error).message}\n`);
  })
  .finally(() => process.exit(failures ? 1 : 0));
