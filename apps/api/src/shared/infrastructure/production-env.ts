/**
 * Con NODE_ENV=production, la API no arranca si la configuración es de desarrollo.
 * Mejor un error claro al hacer el deploy que un CRM público con el secreto de ejemplo o DB_SYNC prendido.
 */
export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];

  if (env.DB_SYNC === 'true') {
    problems.push('DB_SYNC=true: en producción las tablas se actualizan con migraciones (sacá DB_SYNC)');
  }
  if (!env.JWT_SECRET || /cambiar|example/i.test(env.JWT_SECRET)) {
    problems.push('JWT_SECRET es el de ejemplo: generá uno con openssl rand -base64 48');
  }
  for (const key of ['WEB_ORIGIN', 'PUBLIC_URL']) {
    const origins = (env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origins.length) problems.push(`Falta ${key}`);
    for (const origin of origins) {
      if (!origin.startsWith('https://') || /localhost|127\.0\.0\.1/.test(origin)) {
        problems.push(`${key}=${origin}: tiene que ser la dirección pública con https://`);
      }
    }
  }
  if (env.WHATSAPP_TOKEN && !env.WHATSAPP_APP_SECRET) {
    problems.push('Hay WHATSAPP_TOKEN pero falta WHATSAPP_APP_SECRET (sin él no se puede validar la firma del webhook)');
  }

  if (problems.length) {
    throw new Error(`Configuración inválida para producción:\n - ${problems.join('\n - ')}`);
  }
}
