import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { assertProductionEnv } from './shared/infrastructure/production-env';

async function bootstrap() {
  assertProductionEnv();
  // rawBody: necesario para validar la firma HMAC del webhook de WhatsApp
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks(); // al reiniciar el contenedor, cierra la base y los crons de forma ordenada
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
