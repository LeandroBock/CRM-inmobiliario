// Sube un backup al bucket privado y borra los viejos. Lo usa deploy/backup-to-s3.sh.
// Usa el mismo SDK que la API (@aws-sdk/client-s3), así funciona igual con R2, AWS S3 o compatibles.
//
//   node deploy/backup-bucket.mjs upload <archivo> <clave>
//   node deploy/backup-bucket.mjs rotate <prefijo> <días>
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';

const env = (k) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Falta ${k}`);
  return v;
};
const bucket = env('S3_PRIVATE_BUCKET');
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || 'auto',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: env('S3_ACCESS_KEY_ID'), secretAccessKey: env('S3_SECRET_ACCESS_KEY') },
});

const [command, ...args] = process.argv.slice(2);

if (command === 'upload') {
  const [file, key] = args;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(file), ContentType: 'application/octet-stream' }));
  console.log(`Subido a ${bucket}/${key}`);
} else if (command === 'rotate') {
  const [prefix, days] = args;
  // Los nombres llevan la fecha (crm-AAAAMMDD-HHMM.dump): se decide por el nombre, no por la fecha del bucket.
  const cutoff = new Date(Date.now() - Number(days) * 86400_000).toISOString().slice(0, 10).replaceAll('-', '');
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const { Key } of res.Contents ?? []) {
      const day = /crm-(\d{8})-\d{4}\.dump$/.exec(Key ?? '')?.[1];
      if (day && day < cutoff) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
        console.log(`Borrado (más de ${days} días): ${Key}`);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
} else {
  console.error('Uso: backup-bucket.mjs upload <archivo> <clave> | rotate <prefijo> <días>');
  process.exit(2);
}
