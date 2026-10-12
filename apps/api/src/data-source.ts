import { join } from 'node:path';
import { DataSource } from 'typeorm';

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
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, '**', '*.entity.js')],
  migrations: [join(__dirname, 'migrations', '*.js')],
  migrationsTableName: 'migrations',
});
