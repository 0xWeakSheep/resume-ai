import type { NestExpressApplication } from '@nestjs/platform-express';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

export function getWebOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '5mb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: getWebOrigins(process.env.WEB_ORIGIN),
    credentials: true,
  });
  app.enableShutdownHooks();
}
