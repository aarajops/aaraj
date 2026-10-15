import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { API_V1_BASE_PATH } from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { storefrontConfiguration } from "../src/storefront/storefront-schema.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-storefront-e2e-password-123";

describe("storefront settings", () => {
  let app: NestExpressApplication;
  let database: DatabaseService;
  let owner: Account;
  let admin: Account;
  let staff: Account;
  let customer: Account;

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}-${randomUUID()}@storefront-e2e.example`;
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      email,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  function update(actor: Account, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .send(body);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    owner = await createAccount("owner");
    admin = await createAccount("admin");
    staff = await createAccount("staff");
    customer = await createAccount("customer");

    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(owner.id, {
      reason: "Create storefront settings E2E owner",
    });
    await access.changeRole(owner, admin.id, "admin", "grant", {
      reason: "Grant storefront settings E2E administrator",
    });
    await access.changeRole(owner, staff.id, "staff", "grant", {
      reason: "Grant storefront settings E2E staff role",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await database.db.update(storefrontConfiguration).set({
      siteName: "AARAJ",
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("publishes only safe settings and restricts audited changes to authorized admins", async () => {
    const publicResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(publicResponse.headers["cache-control"]).toBe("no-store");
    expect(publicResponse.body).toEqual({
      siteName: "AARAJ",
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
    });

    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .expect(401);
    for (const actor of [staff, customer]) {
      await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
        .set("Cookie", actor.cookie)
        .expect(403);
      await update(actor, {
        siteName: "Unauthorized store",
        announcementEnabled: false,
        announcementText: null,
        supportPhone: null,
        expectedVersion: 1,
        reason: "Try to change the storefront",
      }).expect(403);
    }

    const managementResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(managementResponse.headers["cache-control"]).toBe("no-store");
    expect(managementResponse.body).toEqual({
      siteName: "AARAJ",
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      version: 1,
      updatedAt: null,
    });

    const validUpdate = {
      siteName: "AARAJ Festive Edit",
      announcementEnabled: true,
      announcementText: "Step into the festive season with AARAJ",
      supportPhone: "+8801712345678",
      expectedVersion: 1,
      reason: "Publish the festive storefront update",
    };
    await update(admin, {
      ...validUpdate,
      announcementText: null,
    }).expect(400);
    await update(admin, {
      ...validUpdate,
      internalSecret: "must be rejected",
    }).expect(400);

    await update(admin, validUpdate)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          siteName: "AARAJ Festive Edit",
          announcementEnabled: true,
          announcementText: "Step into the festive season with AARAJ",
          supportPhone: "+8801712345678",
          version: 2,
        });
        expect(body).not.toHaveProperty("updatedBy");
      });

    const updatedPublicSettings = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/storefront/settings`)
      .expect(200);
    expect(updatedPublicSettings.body).toEqual({
      siteName: "AARAJ Festive Edit",
      announcementEnabled: true,
      announcementText: "Step into the festive season with AARAJ",
      supportPhone: "+8801712345678",
    });
    expect(updatedPublicSettings.body).not.toHaveProperty("version");
    expect(updatedPublicSettings.body).not.toHaveProperty("updatedAt");

    const staleResponse = await update(admin, {
      ...validUpdate,
      siteName: "Stale overwrite",
    }).expect(409);
    expect(staleResponse.body.errorCode).toBe("STOREFRONT_SETTINGS_STALE");

    const events = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "storefront.settings_updated"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: "user",
      actorId: admin.id,
      subjectType: "storefront_configuration",
      subjectId: "default",
      reason: validUpdate.reason,
      metadata: {
        previousVersion: 1,
        version: 2,
        changedFields: [
          "siteName",
          "announcementEnabled",
          "announcementText",
          "supportPhone",
        ],
      },
    });
    expect(JSON.stringify(events[0]?.metadata)).not.toContain(
      validUpdate.supportPhone,
    );
  });

  it("rejects untrusted mutation origins and rolls back an update if audit writing fails", async () => {
    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/storefront/manage/settings`)
      .set("Cookie", admin.cookie)
      .send({
        siteName: "Origin blocked",
        announcementEnabled: false,
        announcementText: null,
        supportPhone: null,
        expectedVersion: 1,
        reason: "Test origin protection",
      })
      .expect(403);

    vi.spyOn(app.get(AuditService), "append").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    await update(admin, {
      siteName: "Must roll back",
      announcementEnabled: false,
      announcementText: null,
      supportPhone: null,
      expectedVersion: 1,
      reason: "Test audit transaction rollback",
    }).expect(500);

    const [stored] = await database.db.select().from(storefrontConfiguration);
    expect(stored).toMatchObject({
      id: "default",
      siteName: "AARAJ",
      version: 1,
      updatedBy: null,
    });
  });
});
