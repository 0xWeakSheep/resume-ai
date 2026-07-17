import type { INestApplication } from '@nestjs/common';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

export function getWebOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: getWebOrigins(process.env.WEB_ORIGIN),
    credentials: true,
  });
  app.enableShutdownHooks();
}
