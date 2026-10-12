import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { StorageError } from '../../../shared/infrastructure/s3-bucket';
import { VIDEO_STORAGE, VideoStorage } from '../domain/video-storage.port';

/** Supabase gratis no acepta archivos de más de 50 MB. Alcanza para un Reel o TikTok de 1 minuto en buena calidad. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const GRACE_MS = 24 * 60 * 60 * 1000;

export interface UploadedVideo {
  url: string;
  bytes: number;
}

@Injectable()
export class VideoUploadService {
  private readonly logger = new Logger(VideoUploadService.name);

  constructor(
    @Inject(VIDEO_STORAGE) private readonly storage: VideoStorage,
    private readonly db: DataSource,
  ) {}

  /** `file` viene de multer con diskStorage: el video está en un archivo temporal (no en memoria). */
  async save(file: Express.Multer.File): Promise<UploadedVideo> {
    try {
      const ext = await this.detectFormat(file.path);
      if (!ext) {
        throw new BadRequestException(`"${file.originalname}" no es un video MP4 o MOV. Exportalo desde el celular o la compu como MP4.`);
      }
      const url = await this.storage.save(`${randomUUID()}.${ext}`, file.path, ext === 'mp4' ? 'video/mp4' : 'video/quicktime').catch((err) => {
        this.logger.error(`No se pudo guardar un video: ${(err as Error).message}`);
        throw new ServiceUnavailableException(`No se pudo guardar el video: ${err instanceof StorageError ? err.hint : 'error al guardar el archivo'}.`);
      });
      return { url, bytes: file.size };
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  /** MP4 y MOV (QuickTime) tienen "ftyp" en los bytes 4-7; los MOV, la marca "qt  ". No alcanza con la extensión. */
  private async detectFormat(path: string): Promise<'mp4' | 'mov' | null> {
    const fh = await open(path, 'r');
    try {
      const head = Buffer.alloc(12);
      await fh.read(head, 0, 12, 0);
      if (head.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
      return head.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4';
    } finally {
      await fh.close();
    }
  }

  /** Borra los videos que no usa ninguna publicación (subidos en un formulario cancelado, o de publicaciones borradas). */
  @Cron('40 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async scheduledCleanup(): Promise<void> {
    try {
      const deleted = await this.cleanup();
      if (deleted) this.logger.log(`Videos huérfanos borrados: ${deleted}`);
    } catch (err) {
      this.logger.error(`Falló la limpieza de videos: ${(err as Error).message}`);
    }
  }

  async cleanup(now = new Date()): Promise<number> {
    const rows: { url: string }[] = await this.db.query('SELECT jsonb_array_elements_text(media_urls) AS url FROM social_posts');
    const used = new Set(rows.map((r) => this.storage.fileNameFromUrl(r.url)).filter(Boolean));
    const orphans = (await this.storage.list()).filter((f) => !used.has(f.fileName) && f.createdAt.getTime() < now.getTime() - GRACE_MS);
    for (const f of orphans) await this.storage.remove(f.fileName);
    return orphans.length;
  }
}
