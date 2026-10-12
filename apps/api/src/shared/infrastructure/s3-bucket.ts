import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Configuración común de S3 / Cloudflare R2 / cualquier almacenamiento compatible (variables S3_*). */
export interface S3Settings {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function s3SettingsFromEnv(rawGet: (key: string) => string | undefined): S3Settings {
  // Al pegar claves en un panel es fácil que se cuele un espacio o un salto de línea: nunca son parte del valor.
  const get = (key: string) => rawGet(key)?.trim();
  const accessKeyId = get('S3_ACCESS_KEY_ID');
  const secretAccessKey = get('S3_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) throw new Error('STORAGE_DRIVER=s3 requiere S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY');
  return {
    endpoint: get('S3_ENDPOINT') || undefined, // R2: https://<cuenta>.r2.cloudflarestorage.com · AWS: vacío
    region: get('S3_REGION') || 'auto', // R2 usa "auto"
    accessKeyId,
    secretAccessKey,
    forcePathStyle: get('S3_FORCE_PATH_STYLE') === 'true',
  };
}

/** Falla de S3/R2/Supabase con lo necesario para entenderla: operación, bucket, código y una pista. */
export class StorageError extends Error {
  constructor(
    readonly operation: string,
    readonly bucket: string,
    readonly code: string,
    readonly status: number | undefined,
    detail: string,
    /** Qué credenciales se usaron, sin revelarlas: para comparar con las que deberían ser. */
    private readonly credentialsHint?: string,
  ) {
    super(`${operation} en "${bucket}" falló: ${code}${status ? ` (HTTP ${status})` : ''} — ${detail}`);
  }

  /** Qué revisar, en palabras (para mostrar en pantalla). */
  get hint(): string {
    if (/NoSuchBucket/i.test(this.code)) return `no existe el bucket "${this.bucket}" (revisá S3_PUBLIC_BUCKET / S3_PRIVATE_BUCKET, distinguen mayúsculas)`;
    if (/InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized|InvalidSignature/i.test(this.code)) {
      return `la clave de acceso no es válida (revisá S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY; ${this.credentialsHint})`;
    }
    if (/AccessDenied|Forbidden/i.test(this.code)) return `la clave no tiene permiso sobre "${this.bucket}"`;
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(this.code)) return 'no se puede conectar con el almacenamiento (revisá S3_ENDPOINT)';
    return `error del almacenamiento (${this.code})`;
  }
}

/** Lo mínimo que usa el CRM sobre un bucket: subir, leer, listar y borrar. */
export class S3Bucket {
  private readonly client: S3Client;
  private readonly credentialsHint: string;

  constructor(settings: S3Settings, readonly name: string) {
    // El inicio del ID de la clave no es secreto (es como un usuario); del secreto, solo el largo.
    this.credentialsHint =
      `se está usando la clave ${settings.accessKeyId.slice(0, 4)}… de ${settings.accessKeyId.length} caracteres, ` +
      `secreto de ${settings.secretAccessKey.length} caracteres, endpoint ${settings.endpoint ?? '(AWS)'}`;
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.name, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
    } catch (err) {
      throw this.wrap('Subir', err);
    }
  }

  /** Sube un archivo del disco sin cargarlo entero en memoria (videos). */
  async putFile(key: string, filePath: string, contentType: string, cacheControl?: string): Promise<void> {
    const { size } = await stat(filePath);
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.name, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType, CacheControl: cacheControl }),
      );
    } catch (err) {
      throw this.wrap('Subir', err);
    }
  }

  /** Tamaño en bytes, o null si no existe. */
  async size(key: string): Promise<number | null> {
    try {
      return (await this.client.send(new HeadObjectCommand({ Bucket: this.name, Key: key }))).ContentLength ?? null;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw this.wrap('Consultar', err);
    }
  }

  /** Un tramo del archivo (bytes start..end inclusive), para mandarlo por partes sin cargarlo entero. */
  async getRange(key: string, start: number, end: number): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.name, Key: key, Range: `bytes=${start}-${end}` }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      throw this.wrap('Leer', err);
    }
  }

  /** Los errores del SDK solo dicen "UnknownError" o un código suelto: se agrega qué se estaba haciendo y dónde. */
  private wrap(operation: string, err: unknown): StorageError {
    const e = err as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number }; cause?: { code?: string } };
    const code = e.Code ?? e.cause?.code ?? e.code ?? e.name ?? 'Error';
    return new StorageError(operation, this.name, code, e.$metadata?.httpStatusCode, e.message ?? String(err), this.credentialsHint);
  }

  /** null si no existe. */
  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.name, Key: key }));
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
      throw this.wrap('Leer', err);
    }
  }

  /** Todos los objetos bajo un prefijo (pagina de a 1000). */
  async list(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const out: { key: string; lastModified: Date }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client
        .send(new ListObjectsV2Command({ Bucket: this.name, Prefix: prefix, ContinuationToken: token }))
        .catch((err) => Promise.reject(this.wrap('Listar', err)));
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async delete(key: string): Promise<void> {
    // S3 no falla si no existe
    await this.client.send(new DeleteObjectCommand({ Bucket: this.name, Key: key })).catch((err) => Promise.reject(this.wrap('Borrar', err)));
  }
}
