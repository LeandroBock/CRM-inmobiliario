import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico (AES-256-GCM) para secretos guardados en la base, como los refresh tokens de Google.
 * Si alguien obtiene un backup de la base, sin la clave (TOKEN_ENCRYPTION_KEY) no puede usarlos.
 * Formato: iv.tag.datos, cada parte en base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY tiene que ser de 32 bytes en base64 (openssl rand -base64 32)');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }

  open(sealed: string): string {
    const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    // authTagLength fijo: sin esto Node acepta etiquetas recortadas, que son mucho más fáciles de falsificar.
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
