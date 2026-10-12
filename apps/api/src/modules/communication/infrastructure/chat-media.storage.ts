import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Bucket } from '../../../shared/infrastructure/s3-bucket';
import { uploadsDir } from '../../media/infrastructure/local-photo.storage';

/** Solo nombres generados acá: nunca se lee ni se borra otro archivo. */
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|ogg|mp3|m4a|amr|aac|bin)$/;

const CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
  aac: 'audio/aac',
  bin: 'application/octet-stream',
};

function newFileName(ext: string): string {
  const fileName = `${randomUUID()}.${ext}`;
  if (!FILE_NAME.test(fileName)) throw new Error(`Extensión no permitida: ${ext}`);
  return fileName;
}

function assertName(fileName: string): void {
  if (!FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo inesperado: ${fileName}`);
}

/**
 * Audios y fotos que mandan los clientes por WhatsApp. Son datos personales: nunca son públicos;
 * se leen por GET /chat-media/:id con sesión. Clase abstracta = token de inyección (local o S3).
 */
export abstract class ChatMediaStorage {
  abstract save(data: Buffer, ext: string): Promise<string>;
  /** Lanza si no existe. */
  abstract read(fileName: string): Promise<Buffer>;
  abstract list(): Promise<{ fileName: string; createdAt: Date }[]>;
  abstract remove(fileName: string): Promise<void>;
}

/** En disco, en uploads/chat-media: main.ts solo publica uploads/photos, así que esto no se sirve como estático. */
@Injectable()
export class LocalChatMediaStorage extends ChatMediaStorage {
  private readonly dir = join(uploadsDir(), 'chat-media');

  async save(data: Buffer, ext: string): Promise<string> {
    const fileName = newFileName(ext);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, fileName), data, { flag: 'wx' });
    return fileName;
  }

  read(fileName: string): Promise<Buffer> {
    assertName(fileName);
    return readFile(join(this.dir, fileName));
  }

  async list(): Promise<{ fileName: string; createdAt: Date }[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return Promise.all(names.filter((n) => FILE_NAME.test(n)).map(async (fileName) => ({ fileName, createdAt: (await stat(join(this.dir, fileName))).mtime })));
  }

  async remove(fileName: string): Promise<void> {
    assertName(fileName);
    await unlink(join(this.dir, fileName)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

/** En un bucket PRIVADO (distinto del de fotos de propiedades, que es público). */
export class S3ChatMediaStorage extends ChatMediaStorage {
  private static readonly PREFIX = 'chat-media/';

  constructor(private readonly bucket: S3Bucket) {
    super();
  }

  async save(data: Buffer, ext: string): Promise<string> {
    const fileName = newFileName(ext);
    await this.bucket.put(S3ChatMediaStorage.PREFIX + fileName, data, CONTENT_TYPE[ext] ?? 'application/octet-stream');
    return fileName;
  }

  async read(fileName: string): Promise<Buffer> {
    assertName(fileName);
    const data = await this.bucket.get(S3ChatMediaStorage.PREFIX + fileName);
    if (!data) throw new Error(`No existe ${fileName}`);
    return data;
  }

  async list(): Promise<{ fileName: string; createdAt: Date }[]> {
    return (await this.bucket.list(S3ChatMediaStorage.PREFIX))
      .map((o) => ({ fileName: o.key.slice(S3ChatMediaStorage.PREFIX.length), createdAt: o.lastModified }))
      .filter((f) => FILE_NAME.test(f.fileName));
  }

  async remove(fileName: string): Promise<void> {
    assertName(fileName);
    await this.bucket.delete(S3ChatMediaStorage.PREFIX + fileName);
  }
}
