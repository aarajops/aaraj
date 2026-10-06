import { VersioningType, type INestApplication } from "@nestjs/common";
import { API_V1_ROUTE_VERSION } from "@aaraj/contracts";
import { requestContextMiddleware } from "./platform/request-context.js";

export function configureApp(app: INestApplication): void {
  const isProduction = process.env.NODE_ENV === "production";
  const trustedProxies = process.env.BETTER_AUTH_TRUSTED_PROXIES?.trim();
  if (isProduction && trustedProxies) {
    app
      .getHttpAdapter()
      .getInstance()
      .set(
        "trust proxy",
        trustedProxies.split(",").map((address) => address.trim()),
      );
  }
  app.use(requestContextMiddleware);
  app.useSecurityHeaders({
    strictTransportSecurity: isProduction,
    xFrameOptions: { action: "deny" },
  });
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_V1_ROUTE_VERSION,
  });

  const allowedOrigin = process.env.CLIENT_URL ?? "http://localhost:3000";
  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });
}
