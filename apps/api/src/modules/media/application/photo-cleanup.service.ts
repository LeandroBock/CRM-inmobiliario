import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PHOTO_STORAGE, PhotoStorage } from '../domain/photo-storage.port';

/** Una foto recién subida puede estar en un formulario que todavía no se guardó: se le da un día de margen. */
const GRACE_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  checked: number;
  referenced: number;
  deleted: number;
}

/**
 * Borra del disco las fotos que no usa nadie: subidas en un formulario que se canceló,
 * quitadas de una propiedad o de propiedades eliminadas.
 */
@Injectable()
export class PhotoCleanupService {
  private readonly logger = new Logger(PhotoCleanupService.name);

  constructor(
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
    private readonly db: DataSource,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async scheduled(): Promise<void> {
    try {
      const r = await this.cleanup();
      if (r.deleted) this.logger.log(`Fotos huérfanas borradas: ${r.deleted} de ${r.checked}`);
    } catch (err) {
      this.logger.error(`Falló la limpieza de fotos: ${(err as Error).message}`);
    }
  }

  async cleanup(now = new Date()): Promise<CleanupResult> {
    const files = await this.storage.list();
    const referenced = await this.referencedFileNames();
    const cutoff = now.getTime() - GRACE_MS;

    const orphans = files.filter((f) => !referenced.has(f.fileName) && f.createdAt.getTime() < cutoff);
    for (const f of orphans) await this.storage.remove(f.fileName);
    return { checked: files.length, referenced: referenced.size, deleted: orphans.length };
  }

  /** Toda tabla que guarde URLs de fotos tiene que figurar acá; si no, sus fotos se borrarían. */
  private async referencedFileNames(): Promise<Set<string>> {
    const rows: { url: string }[] = await this.db.query(`
      SELECT jsonb_array_elements_text(photo_urls) AS url FROM properties
      UNION
      SELECT jsonb_array_elements_text(media_urls) AS url FROM social_posts
    `);
    const names = new Set<string>();
    for (const { url } of rows) {
      const name = this.storage.fileNameFromUrl(url);
      if (name) names.add(name);
    }
    return names;
  }
}
