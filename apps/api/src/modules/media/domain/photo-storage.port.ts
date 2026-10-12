/** Puerto de almacenamiento: hoy disco local, mañana S3/R2 sin tocar los casos de uso. */
export interface PhotoStorage {
  /** Guarda el archivo y devuelve su URL pública. */
  save(fileName: string, data: Buffer): Promise<string>;
  /** Archivos guardados, con su fecha de creación. */
  list(): Promise<StoredPhoto[]>;
  remove(fileName: string): Promise<void>;
  /** Nombre del archivo si la URL apunta a este almacenamiento; null si es un link externo. */
  fileNameFromUrl(url: string): string | null;
}

export interface StoredPhoto {
  fileName: string;
  createdAt: Date;
}

export const PHOTO_STORAGE = Symbol('PHOTO_STORAGE');
