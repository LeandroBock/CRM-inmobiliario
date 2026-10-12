import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * "state" firmado para logins OAuth (TikTok): lleva el id del usuario y un vencimiento, firmado con HMAC.
 * El callback es público, así que el usuario se identifica con esto (no se puede falsificar ni reusar después de vencido).
 */
export function signState(userId: string, secret: string, ttlMs = 10 * 60 * 1000): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + ttlMs, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

/** El userId si la firma es válida y no venció; si no, null. */
export function verifyState(state: string, secret: string): string | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  // Se compara el texto (no los bytes decodificados): base64url ignora bits sobrantes del último carácter.
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof u === 'string' && typeof exp === 'number' && exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}
