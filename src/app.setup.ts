import type { NestExpressApplication } from '@nestjs/platform-express';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

type CorsOrigin = boolean | string | RegExp | Array<string | RegExp>;
type CorsOriginCallback = (err: Error | null, origin?: CorsOrigin) => void;

export function getWebOrigins(value: string | undefined): string[] {
  return (value ?? DEFAULT_WEB_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getWebOriginPatterns(value: string | undefined): RegExp[] {
  return (value ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, 'i'));
}

export function isWebOriginAllowed(
  origin: string | undefined,
  exactOrigins: string[],
  originPatterns: RegExp[],
): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.trim();

  return (
    exactOrigins.includes(normalizedOrigin) ||
    originPatterns.some((pattern) => pattern.test(normalizedOrigin))
  );
}

export function configureApp(app: NestExpressApplication): void {
  const exactOrigins = getWebOrigins(process.env.WEB_ORIGIN);
  const originPatterns = getWebOriginPatterns(process.env.WEB_ORIGIN_REGEX);

  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '5mb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: CorsOriginCallback,
    ): void => {
      callback(null, isWebOriginAllowed(origin, exactOrigins, originPatterns));
    },
    credentials: true,
  });
  app.enableShutdownHooks();
}
