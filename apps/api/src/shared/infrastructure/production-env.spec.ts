import { assertProductionEnv } from './production-env';

const valid = {
  NODE_ENV: 'production',
  JWT_SECRET: 'Zk3x9vQpL2mN8rT5wY7aB1cD4eF6gH0jK',
  WEB_ORIGIN: 'https://crm.inmobiliaria.com.ar',
  PUBLIC_URL: 'https://api.crm.inmobiliaria.com.ar',
};

describe('assertProductionEnv', () => {
  it('fuera de producción no exige nada', () => {
    expect(() => assertProductionEnv({ NODE_ENV: 'development', DB_SYNC: 'true' })).not.toThrow();
    expect(() => assertProductionEnv({})).not.toThrow();
  });

  it('acepta una configuración de producción correcta', () => {
    expect(() => assertProductionEnv(valid)).not.toThrow();
    expect(() => assertProductionEnv({ ...valid, WEB_ORIGIN: 'https://a.com.ar, https://www.a.com.ar' })).not.toThrow();
  });

  it.each([
    [{ DB_SYNC: 'true' }, 'DB_SYNC'],
    [{ JWT_SECRET: 'cambiar-por-un-secreto-largo-y-aleatorio' }, 'JWT_SECRET'],
    [{ JWT_SECRET: undefined }, 'JWT_SECRET'],
    [{ PUBLIC_URL: 'http://api.crm.com' }, 'PUBLIC_URL'],
    [{ PUBLIC_URL: 'https://localhost:3000' }, 'PUBLIC_URL'],
    [{ WEB_ORIGIN: undefined }, 'Falta WEB_ORIGIN'],
    [{ WEB_ORIGIN: 'https://ok.com, http://mal.com' }, 'http://mal.com'],
    [{ WHATSAPP_TOKEN: 'EAAB...' }, 'WHATSAPP_APP_SECRET'],
  ])('rechaza %o', (override, message) => {
    expect(() => assertProductionEnv({ ...valid, ...override })).toThrow(message);
  });

  it('junta todos los problemas en un solo mensaje', () => {
    expect(() => assertProductionEnv({ NODE_ENV: 'production', DB_SYNC: 'true' })).toThrow(/DB_SYNC[\s\S]*JWT_SECRET[\s\S]*WEB_ORIGIN[\s\S]*PUBLIC_URL/);
  });
});
