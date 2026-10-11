import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureApp } from "./configure-app.js";
import { loadLocalEnvironment } from "./platform/config/local-environment.js";
import { deriveCartCookieSigningSecret } from "./cart/cart-cookie.js";

loadLocalEnvironment();
const { AppModule } = await import("./app.module.js");

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === "production";
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    cookies: { secret: deriveCartCookieSigningSecret() },
    logger: new ConsoleLogger({
      json: isProduction,
      logLevels: isProduction
        ? ["log", "warn", "error", "fatal"]
        : ["log", "warn", "error", "debug", "verbose", "fatal"],
    }),
  });
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}
await bootstrap();
