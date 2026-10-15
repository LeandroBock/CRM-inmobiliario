import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PHOTO_STORAGE, PhotoStorage } from '../domain/photo-storage.port';
import { ImageAiClient } from '../infrastructure/image-ai.client';
import { UploadedPhoto } from './photo-processing.service';

export type PhotoAiAction = 'amueblar' | 'mejorar' | 'ordenar' | 'personalizado';

/** Lo que se le pide al modelo (en inglés: lo entiende mejor). Siempre: misma habitación, mismo encuadre. */
const KEEP = 'Keep the exact same room and camera angle: walls, windows, doors, floor, ceiling and architecture must not change. Photorealistic real estate photograph.';
const PROMPTS: Record<PhotoAiAction, string> = {
  amueblar: `Virtual staging: furnish this room with modern, tasteful furniture and decor that fit the type of room. ${KEEP}`,
  mejorar: `Professionally enhance this real estate photo: bright natural daylight, balanced exposure, realistic vivid colors, clear blue sky outside. Do not add, remove or move any object. ${KEEP}`,
  ordenar: `Declutter this room: remove clutter, personal items, cables and mess, and tidy it up. Keep the existing furniture. ${KEEP}`,
  personalizado: KEEP,
};

/** Leyenda que queda grabada en la foto: la IA cambia cómo se ve el inmueble y el cliente tiene que saberlo. */
const LABELS: Record<PhotoAiAction, string> = {
  amueblar: 'Imagen ilustrativa · amoblamiento virtual',
  mejorar: 'Imagen ilustrativa · editada con IA',
  ordenar: 'Imagen ilustrativa · editada con IA',
  personalizado: 'Imagen ilustrativa · editada con IA',
};

/** El modelo recibe la foto de referencia en 512×512 como máximo. */
const INPUT_SIDE = 496;
/** Tamaño de la foto generada (lado mayor); múltiplo de 16. */
const OUTPUT_SIDE = 1536;

@Injectable()
export class PhotoAiService {
  private readonly logger = new Logger(PhotoAiService.name);

  constructor(
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
    private readonly ai: ImageAiClient,
  ) {}

  status() {
    return { configured: this.ai.isConfigured() };
  }

  /** Edita una foto ya subida al CRM y guarda el resultado como foto NUEVA (la original no se toca). */
  async edit(opts: { url: string; action: PhotoAiAction; instructions?: string }): Promise<UploadedPhoto> {
    const instructions = opts.instructions?.trim();
    if (opts.action === 'personalizado' && !instructions) throw new BadRequestException('Escribí qué querés cambiar en la foto');
    // Solo fotos de nuestro almacenamiento: no se descargan links de terceros
    const fileName = this.storage.fileNameFromUrl(opts.url);
    if (!fileName) throw new BadRequestException('Solo se pueden editar fotos subidas al CRM (no links externos)');
    const original = await this.storage.read(fileName);
    if (!original) throw new NotFoundException('No encontré esa foto');

    const meta = await sharp(original).metadata();
    const { width, height } = outputSize(meta.width ?? 4, meta.height ?? 3);
    const reference = await sharp(original).rotate().resize({ width: INPUT_SIDE, height: INPUT_SIDE, fit: 'inside' }).jpeg({ quality: 90 }).toBuffer();
    const prompt = [PROMPTS[opts.action], instructions ? `Additional instructions (Spanish): ${instructions}` : ''].filter(Boolean).join(' ');

    const generated = await this.ai.edit(reference, prompt, width, height);

    let data: Buffer;
    try {
      data = await sharp(generated)
        .resize({ width, height, fit: 'cover' })
        .composite([{ input: labelSvg(LABELS[opts.action], width, height), gravity: 'southwest' }])
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch (err) {
      this.logger.error(`La IA devolvió una imagen ilegible: ${(err as Error).message}`);
      throw new ServiceUnavailableException('La IA devolvió una imagen que no se pudo leer. Probá de nuevo.');
    }
    const url = await this.storage.save(`${randomUUID()}.jpg`, data);
    return { url, width, height, bytes: data.length };
  }
}

/** Misma proporción que la original, lado mayor OUTPUT_SIDE, múltiplos de 16 y dentro de 256–1920. */
export function outputSize(w: number, h: number): { width: number; height: number } {
  const scale = OUTPUT_SIDE / Math.max(w, h);
  const fit = (v: number) => Math.min(1920, Math.max(256, Math.round((v * scale) / 16) * 16));
  return { width: fit(w), height: fit(h) };
}

/** Rótulo semitransparente abajo a la izquierda. */
function labelSvg(text: string, width: number, height: number): Buffer {
  const size = Math.round(Math.max(width, height) / 64);
  const pad = Math.round(size * 0.6);
  const boxW = Math.round(text.length * size * 0.56 + pad * 2);
  const boxH = Math.round(size * 1.7);
  const margin = Math.round(size * 0.8);
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW + margin}" height="${boxH + margin}">` +
      `<rect x="${margin}" y="0" width="${boxW}" height="${boxH}" rx="${Math.round(size / 3)}" fill="rgba(0,0,0,0.55)"/>` +
      `<text x="${margin + pad}" y="${Math.round(boxH * 0.68)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" fill="#fff">${escaped}</text>` +
      `</svg>`,
  );
}
