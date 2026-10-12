import { Test, TestingModule } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApp } from "../dist/configure-app.js";
import { deriveCartCookieSigningSecret } from "../dist/cart/cart-cookie.js";
import { configureOpenApi } from "../dist/openapi.js";

describe("AppController (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    configureOpenApi(app);
    await app.init();
  });

  it("/api/health (GET)", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "@aaraj/api",
      version: "0.0.1",
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it("/api/health/ready (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/health/ready")
      .expect(200)
      .expect({ status: "ok", database: "ok", redis: "ok" });
  });

  it("/api/auth/ok (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/auth/ok")
      .expect(200)
      .expect({ ok: true });
  });

  it("serves the Swagger UI and OpenAPI document under the API prefix", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/docs")
      .expect(200)
      .expect("Content-Type", /text\/html/);

    const response = await request(app.getHttpServer())
      .get("/api/v1/docs-json")
      .expect(200)
      .expect("Content-Type", /application\/json/);

    expect(response.body.info).toMatchObject({
      title: "Aaraj API",
      version: "1.0",
    });
    expect(response.body.paths["/api/v1/access/me"].get.security).toContainEqual(
      { cookie: [] },
    );
    expect(response.body.paths["/api/health"].get.security).toBeUndefined();
    expect(response.body.components.securitySchemes.cookie).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "better-auth.session_token",
    });
    expect(
      response.body.paths["/api/v1/catalog/products"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["slug", "name"]),
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
