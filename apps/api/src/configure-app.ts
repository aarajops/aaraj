import { INestApplication } from '@nestjs/common';

export interface AppConfigOptions {
  clientUrl?: string;
}

export function configureApp(
  app: INestApplication,
  options: AppConfigOptions = {},
): void {
  app.setGlobalPrefix('api');

  const allowedOrigins = options.clientUrl ?? process.env.CLIENT_URL ?? 'http://localhost:3000';
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
}
