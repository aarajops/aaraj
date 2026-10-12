import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { API_V1_ROUTE_VERSION } from "@aaraj/contracts";

export function configureOpenApi(app: NestExpressApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Aaraj API")
    .setDescription("Aaraj API documentation")
    .setVersion("1.0")
    .addCookieAuth("better-auth.session_token")
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup(`v${API_V1_ROUTE_VERSION}/docs`, app, documentFactory, {
    useGlobalPrefix: true,
  });
}
