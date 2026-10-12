/** Videos para redes (Reels, TikTok). Públicos: Meta los descarga desde su URL. */
export interface VideoStorage {
  /** Guarda el archivo (desde el disco: los videos no se cargan enteros en memoria) y devuelve su URL pública. */
  save(fileName: string, filePath: string, contentType: string): Promise<string>;
  list(): Promise<{ fileName: string; createdAt: Date }[]>;
  remove(fileName: string): Promise<void>;
  /** Nombre del archivo si la URL es de este almacenamiento; null si es un link externo. */
  fileNameFromUrl(url: string): string | null;
  /** Tamaño en bytes (null si no existe). */
  size(fileName: string): Promise<number | null>;
  /** Bytes start..end (inclusive), para subir a TikTok por partes. */
  readRange(fileName: string, start: number, end: number): Promise<Buffer>;
}

export const VIDEO_STORAGE = Symbol('VIDEO_STORAGE');

/** Solo nombres generados por la API: nunca se toca otro archivo. */
export const VIDEO_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov)$/;

export const VIDEO_CONTENT_TYPE: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime' };

/** ¿La URL es de un video? (por la extensión; los que sube el CRM siempre la tienen). */
export const isVideoUrl = (url: string) => /\.(mp4|mov)(\?.*)?$/i.test(url);
