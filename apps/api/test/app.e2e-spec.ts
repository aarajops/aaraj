import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/configure-app.js";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
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

  it("rate limits repeated email sign-in requests", async () => {
    const url = "/api/auth/sign-in/email";
    const body = {
      email: "not-an-email",
      password: "x",
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app.getHttpServer()).post(url).send(body);
      expect(response.status).toBe(400);
    }

    const limitedResponse = await request(app.getHttpServer())
      .post(url)
      .send(body)
      .expect(429);

    expect(Number(limitedResponse.headers["x-retry-after"])).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await app.close();
  });
});
