import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseConnection } from './shared/infrastructure/database-config';

/**
 * DataSource para el CLI de migraciones (npm run migration:*). Corre sobre el código compilado en dist/.
 * La app no usa este archivo: la conexión se arma en app.module.ts con las mismas rutas de migraciones.
 */
try {
  process.loadEnvFile(join(__dirname, '..', '.env')); // no pisa variables ya definidas (Docker, CI)
} catch {
  // sin .env: se usan las variables de entorno del sistema
}

export default new DataSource({
  type: 'postgres',
  ...databaseConnection((key) => process.env[key]),
  entities: [join(__dirname, '**', '*.entity.js')],
  migrations: [join(__dirname, 'migrations', '*.js')],
  migrationsTableName: 'migrations',
});
