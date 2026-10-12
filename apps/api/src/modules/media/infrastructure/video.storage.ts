import { ConfigService } from '@nestjs/config';
import { copyFile, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Bucket } from '../../../shared/infrastructure/s3-bucket';
import { VIDEO_CONTENT_TYPE, VIDEO_FILE_NAME, VideoStorage } from '../domain/video-storage.port';
import { UPLOADS_ROUTE, uploadsDir } from './local-photo.storage';

const PREFIX = 'videos/';

function assertName(fileName: string) {
  if (!VIDEO_FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo inesperado: ${fileName}`);
}

/** En disco (uploads/videos), servidos por la propia API como archivos estáticos (ver app.setup.ts). */
export class LocalVideoStorage implements VideoStorage {
  private readonly dir = join(uploadsDir(), 'videos');
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    const port = config.get('PORT') ?? 3000;
    this.baseUrl = (config.get<string>('PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '');
  }

  async save(fileName: string, filePath: string): Promise<string> {
    assertName(fileName);
    await mkdir(this.dir, { recursive: true });
    await copyFile(filePath, join(this.dir, fileName));
    return `${this.baseUrl}${UPLOADS_ROUTE}/videos/${fileName}`;
  }

  async list() {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return Promise.all(names.filter((n) => VIDEO_FILE_NAME.test(n)).map(async (fileName) => ({ fileName, createdAt: (await stat(join(this.dir, fileName))).mtime })));
  }

  async remove(fileName: string) {
    assertName(fileName);
    await unlink(join(this.dir, fileName)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  fileNameFromUrl(url: string): string | null {
    try {
      const { pathname } = new URL(url);
      const name = pathname.startsWith(`${UPLOADS_ROUTE}/videos/`) ? pathname.slice(`${UPLOADS_ROUTE}/videos/`.length) : '';
      return VIDEO_FILE_NAME.test(name) ? name : null;
    } catch {
      return null;
    }
  }

  async size(fileName: string) {
    assertName(fileName);
    return (await stat(join(this.dir, fileName)).catch(() => null))?.size ?? null;
  }

  async readRange(fileName: string, start: number, end: number): Promise<Buffer> {
    assertName(fileName);
    const fh = await open(join(this.dir, fileName), 'r');
    try {
      const buf = Buffer.alloc(end - start + 1);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
}

/** En el bucket público (como las fotos), bajo videos/. */
export class S3VideoStorage implements VideoStorage {
  constructor(
    private readonly bucket: S3Bucket,
    private readonly publicUrl: string,
  ) {}

  async save(fileName: string, filePath: string): Promise<string> {
    assertName(fileName);
    const ext = fileName.split('.').pop()!;
    await this.bucket.putFile(PREFIX + fileName, filePath, VIDEO_CONTENT_TYPE[ext], 'public, max-age=31536000, immutable');
    return `${this.publicUrl}/${PREFIX}${fileName}`;
  }

  async list() {
    return (await this.bucket.list(PREFIX))
      .map((o) => ({ fileName: o.key.slice(PREFIX.length), createdAt: o.lastModified }))
      .filter((f) => VIDEO_FILE_NAME.test(f.fileName));
  }

  async remove(fileName: string) {
    assertName(fileName);
    await this.bucket.delete(PREFIX + fileName);
  }

  fileNameFromUrl(url: string): string | null {
    const base = `${this.publicUrl}/${PREFIX}`;
    if (!url.startsWith(base)) return null;
    const name = url.slice(base.length);
    return VIDEO_FILE_NAME.test(name) ? name : null;
  }

  size(fileName: string) {
    assertName(fileName);
    return this.bucket.size(PREFIX + fileName);
  }

  readRange(fileName: string, start: number, end: number) {
    assertName(fileName);
    return this.bucket.getRange(PREFIX + fileName, start, end);
  }
}
