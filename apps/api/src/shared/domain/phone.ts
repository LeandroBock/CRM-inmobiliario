/**
 * Normaliza un teléfono argentino al formato E.164 móvil (+549...), el mismo que usa
 * el webhook de WhatsApp para identificar al lead. Cubre los formatos más comunes:
 *   "341 555-1234"  -> +5493415551234   (sin 0 ni 15, 10 dígitos)
 *   "0341 15 555-1234" -> +5493415551234
 *   "+54 341 555 1234" -> +5493415551234
 * No es una validación exhaustiva: números con códigos de área inusuales conviene cargarlos ya en E.164.
 */
export function normalizePhoneAR(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith('54')) {
    if (!d.startsWith('549')) d = '549' + d.slice(2);
    return '+' + d;
  }

  if (d.startsWith('0')) d = d.slice(1);

  // Prefijo local "15" tras el código de área (2 a 4 dígitos): 341 15 5551234 -> 341 5551234
  if (d.length === 12) {
    for (const area of [2, 3, 4]) {
      if (d.substr(area, 2) === '15') {
        d = d.slice(0, area) + d.slice(area + 2);
        break;
      }
    }
  }
  return '+549' + d;
}
