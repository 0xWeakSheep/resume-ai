import type { INestApplication } from '@nestjs/common';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN,
    credentials: true,
  });
  app.enableShutdownHooks();
}
