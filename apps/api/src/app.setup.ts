import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'node:path';
import { UPLOADS_ROUTE, uploadsDir } from './modules/media/infrastructure/local-photo.storage';
import { webOrigins } from './shared/infrastructure/web-origin';
import { EntityNotFoundFilter } from './shared/presentation/entity-not-found.filter';

/**
 * TRUST_PROXY: cantidad de proxies delante de la API (Caddy, nginx, Cloudflare...). Sin esto, detrás de un proxy
 * todos los pedidos parecen venir de la misma IP y el límite de intentos de login bloquea a todos juntos.
 */
function trustProxy(value = process.env.TRUST_PROXY): number | string | false {
  if (!value || value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Middlewares, validación, CORS y archivos estáticos. Lo usan main.ts y los tests (test/), así se prueba la API
 * configurada igual que en producción. La app se tiene que crear con { rawBody: true } (firma del webhook de WhatsApp).
 */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', trustProxy());
  // Todo lo que llega a /webhooks queda en el log antes de cualquier validación: si Meta "no manda nada", acá se ve.
  const webhookLog = new Logger('Webhooks');
  app.use('/webhooks', (req: { method: string; originalUrl: string; headers: Record<string, unknown> }, res: { statusCode: number; on: (e: string, f: () => void) => void }, next: () => void) => {
    res.on('finish', () =>
      webhookLog.log(`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${String(req.headers['user-agent'] ?? 'sin user-agent').slice(0, 60)}, firma: ${req.headers['x-hub-signature-256'] ? 'sí' : 'no'})`),
    );
    next();
  });
  app.use(
    helmet({
      // La API solo devuelve JSON y archivos; la web (otro origen) tiene que poder mostrar las fotos.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new EntityNotFoundFilter(app.get(HttpAdapterHost).httpAdapter));
  // WEB_ORIGIN admite varios orígenes separados por coma (p. ej. con y sin www).
  const origins = webOrigins(process.env.WEB_ORIGIN);
  app.enableCors({ origin: origins.length === 1 ? origins[0] : origins });
  // Fotos de propiedades: públicas (las ven portales y redes). Los nombres son UUID, no se pueden adivinar ni listar.
  // Solo se publica uploads/photos: el resto de uploads (p. ej. chat-media, audios y fotos de clientes) es privado.
  app.useStaticAssets(join(uploadsDir(), 'photos'), {
    prefix: `${UPLOADS_ROUTE}/photos/`,
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true, // un archivo nunca cambia: cada subida genera un nombre nuevo
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
}
