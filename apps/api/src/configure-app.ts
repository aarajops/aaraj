import type { INestApplication } from "@nestjs/common";

export function configureApp(app: INestApplication): void {
  const isProduction = process.env.NODE_ENV === "production";
  app.useSecurityHeaders({
    strictTransportSecurity: isProduction,
    xFrameOptions: { action: "deny" },
  });
  app.setGlobalPrefix("api");

  const allowedOrigin = process.env.CLIENT_URL ?? "http://localhost:3000";
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });
}
