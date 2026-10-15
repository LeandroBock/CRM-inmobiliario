import { Inject, Injectable } from '@nestjs/common';
import { zipSync } from 'fflate';
import { PHOTO_STORAGE, PhotoStorage } from '../../media/domain/photo-storage.port';
import { PropertiesService } from './properties.service';

/** Todas las fotos de la propiedad en un ZIP, numeradas en orden (01 = portada), para subirlas a los portales. */
@Injectable()
export class PhotosZipService {
  constructor(
    private readonly properties: PropertiesService,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {}

  async build(id: string): Promise<{ zip: Buffer; fileName: string }> {
    const p = await this.properties.findOne(id);
    const files: Record<string, Uint8Array> = {};
    const external: string[] = [];
    let n = 0;
    for (const url of p.photoUrls) {
      const name = this.storage.fileNameFromUrl(url);
      const data = name ? await this.storage.read(name) : null;
      if (!data) {
        external.push(url);
        continue;
      }
      // Los JPG ya vienen comprimidos: se guardan sin volver a comprimir (level 0), más rápido y mismo tamaño
      files[`${String(++n).padStart(2, '0')}.jpg`] = new Uint8Array(data);
    }
    if (external.length) {
      files['fotos-externas.txt'] = new TextEncoder().encode(`Estas fotos son links externos (no están subidas al CRM):\n${external.join('\n')}\n`);
    }
    const zip = Buffer.from(zipSync(files, { level: 0 }));
    const slug = p.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    return { zip, fileName: `fotos-${slug || 'propiedad'}.zip` };
  }
}
