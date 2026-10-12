import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PhotoStorage, StoredPhoto } from '../domain/photo-storage.port';

/** Solo nombres generados por la API (UUID.jpg): nunca se toca otro archivo de la carpeta. */
export const PHOTO_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Prefijo HTTP bajo el que main.ts sirve la carpeta de subidas. */
export const UPLOADS_ROUTE = '/uploads';

export function uploadsDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? 'uploads');
}

/**
 * Guarda las fotos en disco y las sirve la propia API.
 * Ojo: Meta/LinkedIn/TikTok descargan las imágenes desde su URL, así que para publicar en redes
 * PUBLIC_URL tiene que ser una dirección accesible desde internet (no localhost).
 */
@Injectable()
export class LocalPhotoStorage implements PhotoStorage {
  private readonly dir = join(uploadsDir(), 'photos');
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    const port = config.get('PORT') ?? 3000;
    this.baseUrl = (config.get<string>('PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '');
  }

  async save(fileName: string, data: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, fileName), data, { flag: 'wx' }); // wx: nunca pisa un archivo existente
    return `${this.baseUrl}${UPLOADS_ROUTE}/photos/${fileName}`;
  }

  async list(): Promise<StoredPhoto[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return []; // la carpeta todavía no existe: no se subió nada
    }
    const photos = await Promise.all(
      names.filter((n) => PHOTO_FILE_NAME.test(n)).map(async (fileName) => ({ fileName, createdAt: (await stat(join(this.dir, fileName))).mtime })),
    );
    return photos;
  }

  async remove(fileName: string): Promise<void> {
    if (!PHOTO_FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo inesperado: ${fileName}`);
    await unlink(join(this.dir, fileName)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  /** Se mira solo la ruta (no el host): las fotos siguen siendo "nuestras" aunque cambie PUBLIC_URL. */
  fileNameFromUrl(url: string): string | null {
    try {
      const { pathname } = new URL(url);
      const prefix = `${UPLOADS_ROUTE}/photos/`;
      if (!pathname.startsWith(prefix)) return null;
      const name = pathname.slice(prefix.length);
      return PHOTO_FILE_NAME.test(name) ? name : null;
    } catch {
      return null;
    }
  }
}
