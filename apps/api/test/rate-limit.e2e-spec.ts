import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";

const origin = "http://localhost:3000";
const password = "aaraj-e2e-password-123";

describe("distributed rate limits", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("limits email sign-in attempts to five per minute", async () => {
    const email = `rate-limit-${randomUUID()}@example.test`;
    const account = await auth.api.signUpEmail({
      body: { name: "Rate limit test", email, password },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(account.status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post("/api/auth/sign-in/email")
        .set("Origin", origin)
        .send({ email, password: "incorrect-password-123" })
        .expect(401);
    }

    const limited = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("Origin", origin)
      .send({ email, password: "incorrect-password-123" })
      .expect(429);
    expect(limited.headers["x-retry-after"]).toMatch(/^\d+$/);
  });

  it("limits public API reads to 120 requests per minute", async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await request(app.getHttpServer())
        .get("/api/v1/catalog/categories")
        .expect(200);
    }

    const limited = await request(app.getHttpServer())
      .get("/api/v1/catalog/categories")
      .expect(429);
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);

    const repeated = await request(app.getHttpServer())
      .get("/api/v1/catalog/categories")
      .expect(429);
    expect(Number(repeated.headers["retry-after"])).toBeLessThanOrEqual(
      retryAfter,
    );
  });
});
