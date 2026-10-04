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
import { catalogProduct } from "../src/catalog/catalog-schema.js";

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
      .expect({ products: [], hasMore: false, nextOffset: null });
    await request(app.getHttpServer())
      .get("/api/catalog/products?limit=101")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .set("Cookie", customer.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/catalog/size-guides/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/catalog/size-guides/manage")
      .set("Cookie", customer.cookie)
      .expect(403);

    const guide = await request(app.getHttpServer())
      .post("/api/catalog/size-guides")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        name: "Aaraj classic T-shirt",
        category: "T-shirts",
        fit: "Regular",
        measurementBasis: "garment",
        inputUnit: "in",
        rows: [
          {
            sizeLabel: "M",
            measurements: [
              { key: "chest_width", value: "20.000" },
              { key: "body_length", value: "28.000" },
            ],
          },
          {
            sizeLabel: "L",
            measurements: [
              { key: "chest_width", value: "21.000" },
              { key: "body_length", value: "29.000" },
            ],
          },
        ],
        reason: "Create reusable T-shirt size guide",
      })
      .expect(201);
    const guideId = guide.body.id as string;
    expect(guide.body.rows[0].measurements).toEqual(
      expect.arrayContaining([
        { key: "chest_width", valueMm: "508.00" },
        { key: "body_length", valueMm: "711.20" },
      ]),
    );
    await request(app.getHttpServer())
      .get("/api/catalog/size-guides/manage?limit=10")
      .set("Cookie", staff.cookie)
      .expect("Cache-Control", "no-store")
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", customer.cookie)
      .set("Origin", origin)
      .send({
        slug: "customer-tee",
        name: "Customer tee",
        audience: "unisex",
        category: "T-shirts",
        reason: "Catalog draft",
      })
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "missing-size-tee",
        name: "Missing size tee",
        audience: "unisex",
        category: "T-shirts",
        fit: "Regular",
        sizeGuideId: guideId,
        isPublished: true,
        reason: "Reject unavailable size",
        variants: [{ sku: "TEE-MISSING-S", color: "Black", sizeLabel: "S" }],
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "aaraj-draft-tee",
        name: "Aaraj Draft Tee",
        description: "Local apparel test product",
        audience: "unisex",
        category: "T-shirts",
        fit: "Regular",
        sizeGuideId: guideId,
        variants: [{ sku: "AA-TEE-BLK-M", color: "Black", sizeLabel: "M" }],
        reason: "Initial catalog entry",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      slug: "aaraj-draft-tee",
      name: "Aaraj Draft Tee",
      isPublished: false,
    });

    await request(app.getHttpServer())
      .get("/api/catalog/products")
      .expect(200)
      .expect({ products: [], hasMore: false, nextOffset: null });
    await request(app.getHttpServer())
      .get("/api/catalog/products/aaraj-draft-tee")
      .expect(404);
    const managed = await request(app.getHttpServer())
      .get("/api/catalog/products/manage")
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(managed.body.products).toHaveLength(1);
    expect(managed.body.products[0].id).toBe(created.body.id);
    const managedDetail = await request(app.getHttpServer())
      .get(`/api/catalog/products/manage/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(managedDetail.body.variants).toHaveLength(1);
    expect(managedDetail.body.sizeGuide.id).toBe(guideId);

    await request(app.getHttpServer())
      .patch(`/api/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        variants: [
          { sku: "TEE-M-1", color: "Black", sizeLabel: "M" },
          { sku: "TEE-M-2", color: " black ", sizeLabel: "m" },
        ],
        reason: "Reject duplicate color size",
      })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "duplicate-sku-tee",
        name: "Duplicate SKU Tee",
        audience: "men",
        category: "T-shirts",
        variants: [{ sku: "aa-tee-blk-m", color: "White", sizeLabel: "M" }],
        reason: "Reject reused SKU",
      })
      .expect(409);

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
      .send({ name: "Aaraj City Tee", reason: "Corrected product name" })
      .expect(200);

    const publicProduct = await request(app.getHttpServer())
      .get("/api/catalog/products/aaraj-draft-tee")
      .expect(200);
    expect(publicProduct.body.name).toBe("Aaraj City Tee");
    expect(publicProduct.body.variants).toHaveLength(1);
    expect(publicProduct.body.variants[0]).not.toHaveProperty("sku");
    expect(publicProduct.body.sizeGuide.rows).toHaveLength(2);

    await request(app.getHttpServer())
      .post("/api/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "aaraj-city-shirt",
        name: "Aaraj City Shirt",
        audience: "men",
        category: "T-shirts",
        fit: "Regular",
        sizeGuideId: guideId,
        variants: [{ sku: "AA-TEE-WHT-L", color: "White", sizeLabel: "L" }],
        isPublished: true,
        reason: "Second item for pagination coverage",
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/catalog/size-guides/${guideId}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        name: "Aaraj incomplete chart",
        category: "T-shirts",
        fit: "Regular",
        measurementBasis: "garment",
        inputUnit: "cm",
        rows: [
          {
            sizeLabel: "M",
            measurements: [
              { key: "chest_width", value: "50.8" },
              { key: "body_length", value: "71.12" },
            ],
          },
        ],
        reason: "Try removing active size",
      })
      .expect(400);

    const firstProductPage = await request(app.getHttpServer())
      .get("/api/catalog/products?limit=1")
      .expect(200);
    expect(firstProductPage.body.products).toHaveLength(1);
    expect(firstProductPage.body.hasMore).toBe(true);
    expect(firstProductPage.body.nextOffset).toBe(1);
    const secondProductPage = await request(app.getHttpServer())
      .get(
        `/api/catalog/products?limit=1&offset=${firstProductPage.body.nextOffset}`,
      )
      .expect(200);
    expect(secondProductPage.body.products).toHaveLength(1);
    expect(secondProductPage.body.hasMore).toBe(false);
    expect(secondProductPage.body.nextOffset).toBeNull();
    expect(secondProductPage.body.products[0].id).not.toBe(
      firstProductPage.body.products[0].id,
    );

    const publicList = await request(app.getHttpServer())
      .get("/api/catalog/products?limit=10")
      .expect(200);
    expect(
      publicList.body.products.map((product: { slug: string }) => product.slug),
    ).toHaveLength(2);

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
    expect(() =>
      JSON.parse(
        Buffer.from(page.body.nextCursor, "base64url").toString("utf8"),
      ),
    ).toThrow();
    const finalCursorCharacter = page.body.nextCursor.slice(-1);
    const tamperedCursor =
      page.body.nextCursor.slice(0, -1) +
      (finalCursorCharacter === "A" ? "B" : "A");
    await request(app.getHttpServer())
      .get(
        `/api/audit/events?eventType=catalog.product_updated&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(tamperedCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get(
        `/api/audit/events?eventType=catalog.product_created&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(400);
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

    const [legacyProduct] = await database.db
      .insert(catalogProduct)
      .values({
        slug: "legacy-unpublished-item",
        name: "Legacy item",
        isPublished: true,
      })
      .returning();
    if (!legacyProduct) throw new Error("Legacy product insert failed.");
    await request(app.getHttpServer())
      .patch(`/api/catalog/products/${legacyProduct.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ isPublished: false, reason: "Unpublish legacy catalog row" })
      .expect(200);
  });
});
