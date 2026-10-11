import { RequestMethod, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { API_V1_BASE_PATH, API_V1_ROUTE_VERSION } from "@aaraj/contracts";
import { requestContextMiddleware } from "./platform/request-context.js";
import { getStorefrontOrigin } from "./platform/config/storefront-origin.js";

export function configureApp(app: NestExpressApplication): void {
  const isProduction = process.env.NODE_ENV === "production";
  const allowedOrigin = getStorefrontOrigin();
  if (isProduction && new URL(allowedOrigin).protocol !== "https:") {
    throw new Error("CLIENT_URL must use HTTPS in production.");
  }
  app.enableCsrfProtection({
    trustedOrigins: [allowedOrigin],
    exclude: [
      {
        path: "delivery/pathao/webhook",
        method: RequestMethod.POST,
        version: API_V1_ROUTE_VERSION,
      },
    ],
  });
  const webhookPath = `${API_V1_BASE_PATH}/delivery/pathao/webhook`;
  app.useBodyParser("json", {
    limit: "32kb",
    strict: true,
    type: (request) => {
      const path = request.url?.split("?")[0];
      const contentType = request.headers["content-type"];

      return (
        request.method === "POST" &&
        path === webhookPath &&
        typeof contentType === "string" &&
        /^application\/json(?:\s*;|$)/i.test(contentType)
      );
    },
  });
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

  app.enableCors({
    origin: allowedOrigin,
    credentials: true,
  });
}
