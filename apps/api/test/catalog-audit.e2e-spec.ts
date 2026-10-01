import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { getPostgresPool } from "../src/platform/database/database-client.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { AccessService } from "../src/platform/authorization/access.service.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-e2e-password-123";

describe("catalog and security audit", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let owner: Account;
  let staff: Account;
  let customer: Account;

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}@catalog-e2e.example`;
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

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    owner = await createAccount("owner");
    staff = await createAccount("staff");
    customer = await createAccount("customer");
    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(owner.id, { reason: "E2E test owner" });
    await access.changeRole(owner, staff.id, "staff", "grant", {
      reason: "E2E catalog staff",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("protects drafts, audits catalog changes, and exposes audit only to superadmins", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("Origin", origin)
      .send({ email: customer.email, password: "incorrect-password-123" })
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/catalog/products")
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .set("Cookie", customer.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", customer.cookie)
      .set("Origin", origin)
      .send({ slug: "draft-bike", name: "Draft bike", reason: "Catalog draft" })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "aaraj-draft-bike",
        name: "Aaraj Draft Bike",
        description: "Local test product",
        reason: "Initial catalog entry",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      slug: "aaraj-draft-bike",
      name: "Aaraj Draft Bike",
      isPublished: false,
    });

    await request(app.getHttpServer())
      .get("/api/catalog/products")
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .get("/api/catalog/products/aaraj-draft-bike")
      .expect(404);
    const managed = await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(managed.body).toHaveLength(1);
    expect(managed.body[0].id).toBe(created.body.id);

    await request(app.getHttpServer())
      .patch(`/api/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ isPublished: true, reason: "Approved for storefront" })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ name: "Aaraj City Bike", reason: "Corrected product name" })
      .expect(200);

    const publicProduct = await request(app.getHttpServer())
      .get("/api/catalog/products/aaraj-draft-bike")
      .expect(200);
    expect(publicProduct.body.name).toBe("Aaraj City Bike");
    const publicList = await request(app.getHttpServer())
      .get("/api/catalog/products?limit=10")
      .expect(200);
    expect(
      publicList.body.map((product: { slug: string }) => product.slug),
    ).toEqual(["aaraj-draft-bike"]);

    await request(app.getHttpServer()).get("/api/audit/events").expect(401);
    await request(app.getHttpServer())
      .get("/api/audit/events")
      .set("Cookie", customer.cookie)
      .expect(403);

    const page = await request(app.getHttpServer())
      .get(
        "/api/audit/events?eventType=catalog.product_updated&actorId=" +
          staff.id +
          "&limit=1",
      )
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(page.body.events).toHaveLength(1);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const nextPage = await request(app.getHttpServer())
      .get(
        `/api/audit/events?eventType=catalog.product_updated&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(nextPage.body.events).toHaveLength(1);
    expect(nextPage.body.nextCursor).toBeNull();

    await getPostgresPool().query(
      `INSERT INTO audit.event
        (actor_type, event_type, subject_type, subject_id, occurred_at)
       VALUES
        ('service', 'audit.cursor_probe', 'test', 'microsecond-later', $1::timestamptz),
        ('service', 'audit.cursor_probe', 'test', 'microsecond-earlier', $2::timestamptz)`,
      ["2020-01-01T00:00:00.123456Z", "2020-01-01T00:00:00.123455Z"],
    );
    const expectedCursorIds = (
      await getPostgresPool().query<{ id: string }>(
        "SELECT id FROM audit.event WHERE event_type = $1 ORDER BY occurred_at DESC, id DESC",
        ["audit.cursor_probe"],
      )
    ).rows.map((row) => row.id);
    const firstCursorPage = await request(app.getHttpServer())
      .get("/api/audit/events?eventType=audit.cursor_probe&limit=1")
      .set("Cookie", owner.cookie)
      .expect(200);
    const secondCursorPage = await request(app.getHttpServer())
      .get(
        `/api/audit/events?eventType=audit.cursor_probe&limit=1&cursor=${encodeURIComponent(firstCursorPage.body.nextCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(200);
    expect([
      ...firstCursorPage.body.events.map((event: { id: string }) => event.id),
      ...secondCursorPage.body.events.map((event: { id: string }) => event.id),
    ]).toEqual(expectedCursorIds);
    expect(secondCursorPage.body.nextCursor).toBeNull();

    const auditViews = await database.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.eventType, "audit.events_viewed"),
          eq(auditEvent.actorId, owner.id),
        ),
      );
    expect(auditViews.length).toBeGreaterThanOrEqual(4);
    expect(
      auditViews.some((event) =>
        Object.entries({
          eventType: "audit.cursor_probe",
          limit: 1,
          returned: 1,
        }).every(([key, value]) => event.metadata[key] === value),
      ),
    ).toBe(true);

    const authEvents = await database.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.eventType, "auth.email_sign_up"),
          eq(auditEvent.actorId, staff.id),
        ),
      );
    expect(authEvents).toHaveLength(1);
    expect(authEvents[0]?.metadata).toEqual({ outcome: "success" });
    const failedSignIns = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "auth.email_sign_in"));
    expect(failedSignIns).toHaveLength(1);
    expect(failedSignIns[0]?.actorType).toBe("anonymous");
    expect(failedSignIns[0]?.metadata).toEqual({ outcome: "failure" });
    const denialEvents = await database.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.eventType, "authorization.denied"),
          eq(auditEvent.actorId, customer.id),
        ),
      );
    expect(denialEvents.length).toBeGreaterThanOrEqual(2);
    expect(denialEvents.every((event) => !("email" in event.metadata))).toBe(
      true,
    );

    const productEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, created.body.id));
    expect(productEvents.map((event) => event.eventType)).toEqual([
      "catalog.product_created",
      "catalog.product_updated",
      "catalog.product_updated",
    ]);
    expect(productEvents[0]?.reason).toBe("Initial catalog entry");

    await expect(
      getPostgresPool().query(
        "UPDATE audit.event SET reason = $1 WHERE id = $2",
        ["tampered", productEvents[0]!.id],
      ),
    ).rejects.toThrow("audit.event is append-only");
    await expect(
      getPostgresPool().query("DELETE FROM audit.event WHERE id = $1", [
        productEvents[0]!.id,
      ]),
    ).rejects.toThrow("audit.event is append-only");
    await expect(
      getPostgresPool().query("TRUNCATE audit.event"),
    ).rejects.toThrow("audit.event is append-only");
  });
});
