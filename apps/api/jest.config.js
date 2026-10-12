/**
 * npm test -w apps/api
 * - src/**\/*.spec.ts: tests unitarios (sin base).
 * - test/**\/*.e2e-spec.ts: la API entera contra una base de prueba aparte (crm_test). Necesita la base de Docker levantada.
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 30_000,
};
