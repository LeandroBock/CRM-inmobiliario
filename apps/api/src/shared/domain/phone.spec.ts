import { normalizePhoneAR } from './phone';

describe('normalizePhoneAR', () => {
  it.each([
    ['341 555-1234', '+5493415551234'],
    ['0341 15 555-1234', '+5493415551234'],
    ['(0341) 155551234', '+5493415551234'],
    ['+54 341 555 1234', '+5493415551234'],
    ['+54 9 341 555-1234', '+5493415551234'],
    ['0054 9 341 5551234', '+5493415551234'],
    ['5493415551234', '+5493415551234'],
    ['011 15 4444-5555', '+5491144445555'], // CABA: área de 2 dígitos
    ['11 4444-5555', '+5491144445555'],
    ['02954 15 444555', '+5492954444555'], // área de 4 dígitos (Santa Rosa)
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhoneAR(raw)).toBe(expected);
  });

  it('el mismo número escrito de formas distintas da el mismo resultado (así no se duplican leads)', () => {
    const variants = ['341 555-1234', '0341 15 555-1234', '+54 9 341 555 1234', '+543415551234'];
    expect(new Set(variants.map(normalizePhoneAR)).size).toBe(1);
  });
});
