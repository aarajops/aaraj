import type { INestApplication } from "@nestjs/common";

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("api");

  const allowedOrigin = process.env.CLIENT_URL ?? "http://localhost:3000";
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });
}
