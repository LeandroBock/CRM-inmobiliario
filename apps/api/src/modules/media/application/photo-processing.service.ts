import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { StorageError } from '../../../shared/infrastructure/s3-bucket';
import { PHOTO_STORAGE, PhotoStorage } from '../domain/photo-storage.port';

/** Lado mayor máximo: suficiente para portales y redes, liviano para WhatsApp. */
const MAX_SIDE = 1920;
const JPEG_QUALITY = 82;
/** Evita "bombas" de descompresión (una imagen chica en bytes que ocupa GB al decodificarse). */
const MAX_INPUT_PIXELS = 80_000_000;

export interface UploadedPhoto {
  url: string;
  width: number;
  height: number;
  bytes: number;
}

@Injectable()
export class PhotoProcessingService {
  private readonly logger = new Logger(PhotoProcessingService.name);
  constructor(@Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage) {}

  async processAll(files: Express.Multer.File[]): Promise<UploadedPhoto[]> {
    if (!files?.length) throw new BadRequestException('No llegó ninguna foto');
    // Primero se procesan todas: si una falla no queda la mitad guardada.
    const processed = await Promise.all(files.map((f) => this.toJpeg(f)));
    try {
      return await Promise.all(
        processed.map(async (p) => ({
          url: await this.storage.save(`${randomUUID()}.jpg`, p.data),
          width: p.width,
          height: p.height,
          bytes: p.data.length,
        })),
      );
    } catch (err) {
      // El detalle técnico va al log; en pantalla, qué revisar.
      this.logger.error(`No se pudo guardar una foto: ${(err as Error).message}`);
      const hint = err instanceof StorageError ? err.hint : 'error al guardar el archivo';
      throw new ServiceUnavailableException(`No se pudo guardar la foto: ${hint}.`);
    }
  }

  /**
   * Redimensiona y convierte a JPG. sharp descarta TODOS los metadatos al exportar
   * (no se llama a withMetadata/keepExif), así que se van el GPS del celular, el modelo de cámara, etc.
   * Antes se aplica la orientación EXIF con rotate(), porque sin ese dato la foto quedaría girada.
   */
  private async toJpeg(file: Express.Multer.File): Promise<{ data: Buffer; width: number; height: number }> {
    try {
      const { data, info } = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // PNG/WebP con transparencia: fondo blanco en vez de negro
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    } catch {
      throw new BadRequestException(
        `No pude leer "${file.originalname}". Usá JPG, PNG o WebP (las fotos HEIC de iPhone exportalas como JPG).`,
      );
    }
  }
}
