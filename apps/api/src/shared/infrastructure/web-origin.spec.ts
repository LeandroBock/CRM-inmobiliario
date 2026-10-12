import { primaryWebOrigin, webOrigins } from './web-origin';

describe('webOrigins', () => {
  it('separa por coma, recorta espacios y barras finales', () => {
    expect(webOrigins(' https://a.com/ , https://www.a.com ')).toEqual(['https://a.com', 'https://www.a.com']);
  });

  it('sin valor usa la web de desarrollo', () => {
    expect(webOrigins(undefined)).toEqual(['http://localhost:5173']);
    expect(webOrigins(' , ')).toEqual(['http://localhost:5173']);
  });

  it('los links usan el primero', () => {
    expect(primaryWebOrigin('https://a.com,https://www.a.com')).toBe('https://a.com');
  });
});
