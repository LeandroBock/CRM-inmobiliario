import { definedOnly } from './defined-only';

describe('definedOnly', () => {
  it('saca los undefined pero conserva null (null = borrar el dato)', () => {
    expect(definedOnly({ a: 1, b: undefined, c: null, d: '' })).toEqual({ a: 1, c: null, d: '' });
  });
});
