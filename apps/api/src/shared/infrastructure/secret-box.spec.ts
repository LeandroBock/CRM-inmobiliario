import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');
  const box = new SecretBox(key);

  it('cifra y descifra', () => {
    const sealed = box.seal('1//refresh-token-de-google');
    expect(sealed).not.toContain('refresh');
    expect(box.open(sealed)).toBe('1//refresh-token-de-google');
  });

  it('el mismo texto se cifra distinto cada vez', () => {
    expect(box.seal('abc')).not.toBe(box.seal('abc'));
  });

  it('con otra clave no se puede abrir', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.open(box.seal('secreto'))).toThrow();
  });

  it('detecta si alguien modificó el dato cifrado', () => {
    const [iv, tag, data] = box.seal('secreto').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => box.open([iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('no acepta una etiqueta de autenticación recortada', () => {
    const [iv, tag, data] = box.seal('secreto').split('.');
    const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box.open([iv, shortTag, data].join('.'))).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow('32 bytes');
    expect(() => new SecretBox('')).toThrow('32 bytes');
  });
});
