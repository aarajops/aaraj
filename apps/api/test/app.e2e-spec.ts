import { Test, TestingModule } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";

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

  afterAll(async () => {
    await app.close();
  });
});
