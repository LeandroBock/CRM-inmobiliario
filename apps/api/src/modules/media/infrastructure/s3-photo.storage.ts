import { PhotoStorage, StoredPhoto } from '../domain/photo-storage.port';
import { S3Bucket } from '../../../shared/infrastructure/s3-bucket';
import { PHOTO_FILE_NAME } from './local-photo.storage';

const PREFIX = 'photos/';

/**
 * Fotos de propiedades en un bucket PÚBLICO (S3, R2...): las ven portales y redes.
 * `publicUrl` es la dirección pública del bucket (dominio de R2, CloudFront, etc.), sin barra final.
 */
export class S3PhotoStorage implements PhotoStorage {
  constructor(
    private readonly bucket: S3Bucket,
    private readonly publicUrl: string,
  ) {}

  async save(fileName: string, data: Buffer): Promise<string> {
    // Cada subida tiene nombre nuevo (UUID), así que el archivo nunca cambia: se puede cachear para siempre.
    await this.bucket.put(PREFIX + fileName, data, 'image/jpeg', 'public, max-age=31536000, immutable');
    return `${this.publicUrl}/${PREFIX}${fileName}`;
  }

  async list(): Promise<StoredPhoto[]> {
    return (await this.bucket.list(PREFIX))
      .map((o) => ({ fileName: o.key.slice(PREFIX.length), createdAt: o.lastModified }))
      .filter((f) => PHOTO_FILE_NAME.test(f.fileName));
  }

  async remove(fileName: string): Promise<void> {
    if (!PHOTO_FILE_NAME.test(fileName)) throw new Error(`Nombre de archivo inesperado: ${fileName}`);
    await this.bucket.delete(PREFIX + fileName);
  }

  async read(fileName: string): Promise<Buffer | null> {
    if (!PHOTO_FILE_NAME.test(fileName)) return null;
    return this.bucket.get(PREFIX + fileName);
  }

  fileNameFromUrl(url: string): string | null {
    const base = `${this.publicUrl}/${PREFIX}`;
    if (!url.startsWith(base)) return null;
    const name = url.slice(base.length);
    return PHOTO_FILE_NAME.test(name) ? name : null;
  }
}
