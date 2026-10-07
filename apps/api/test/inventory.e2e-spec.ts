import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import {
  catalogProduct,
  catalogProductVariant,
} from "../src/catalog/catalog-schema.js";
import {
  inventoryStockBalance,
  inventoryStockMovement,
} from "../src/inventory/inventory-schema.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-inventory-e2e-password-123";

describe("variant inventory adjustments", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let owner: Account;
  let staff: Account;
  let customer: Account;
  let variantId: string;

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}@inventory-e2e.example`;
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

  function adjustment(commandId: string, delta: number, reason: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/inventory/manage/${variantId}/adjustments`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ commandId, delta, reason });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);

    owner = await createAccount("owner");
    staff = await createAccount("staff");
    customer = await createAccount("customer");
    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(owner.id, {
      reason: "Inventory E2E test owner",
    });
    await access.changeRole(owner, staff.id, "staff", "grant", {
      reason: "Inventory E2E stock operator",
    });

    const [product] = await database.db
      .insert(catalogProduct)
      .values({
        slug: `inventory-test-${randomUUID()}`,
        name: "Inventory E2E product",
        audience: "unisex",
      })
      .returning();
    if (!product)
      throw new Error("Could not create the inventory test product.");

    const [variant] = await database.db
      .insert(catalogProductVariant)
      .values({
        productId: product.id,
        sku: `INV-${randomUUID()}`,
        color: "Black",
        sizeLabel: "M",
        priceBdt: 100,
      })
      .returning();
    if (!variant)
      throw new Error("Could not create the inventory test variant.");
    variantId = variant.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("authorizes stock reads and rejects malformed adjustment commands", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/inventory/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/inventory/manage")
      .set("Cookie", customer.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/manage/${variantId}/adjustments`)
      .set("Cookie", customer.cookie)
      .set("Origin", origin)
      .send({ commandId: randomUUID(), delta: 1, reason: "Receive goods" })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/inventory/manage/${randomUUID()}`)
      .set("Cookie", customer.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/inventory/manage?limit=101")
      .set("Cookie", staff.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/inventory/manage?unexpected=value")
      .set("Cookie", staff.cookie)
      .expect(400);
    await adjustment(randomUUID(), 0, "Invalid zero delta").expect(400);
    await adjustment(randomUUID(), 1, "x").expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/manage/${variantId}/adjustments`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        commandId: randomUUID(),
        delta: 1,
        reason: "Receive goods",
        unexpected: true,
      })
      .expect(400);

    const page = await request(app.getHttpServer())
      .get("/api/v1/inventory/manage?search=INV-&limit=25")
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(page.body).toMatchObject({
      hasMore: false,
      nextOffset: null,
      variants: [
        {
          id: variantId,
          productName: "Inventory E2E product",
          sku: expect.stringContaining("INV-"),
          quantityOnHand: 0,
          stockUpdatedAt: null,
        },
      ],
    });
  });

  it("serializes duplicate commands and concurrent removals without negative stock", async () => {
    const receive = {
      commandId: randomUUID(),
      delta: 5,
      reason: "Receive opening stock",
    };
    const duplicates = await Promise.all([
      adjustment(receive.commandId, receive.delta, receive.reason),
      adjustment(receive.commandId, receive.delta, receive.reason),
    ]);
    expect(duplicates.map(({ status }) => status)).toEqual([201, 201]);
    expect(duplicates[0]?.body).toEqual(duplicates[1]?.body);
    expect(duplicates[0]?.body).toMatchObject({
      variantId,
      commandId: receive.commandId,
      delta: 5,
      quantityOnHand: 5,
    });

    await adjustment(receive.commandId, 1, receive.reason).expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/manage/${variantId}/adjustments`)
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send(receive)
      .expect(409);

    const removals = await Promise.all([
      adjustment(randomUUID(), -4, "Remove damaged stock"),
      adjustment(randomUUID(), -4, "Remove damaged stock"),
    ]);
    expect(
      removals.map(({ status }) => status).sort((left, right) => left - right),
    ).toEqual([201, 409]);

    await request(app.getHttpServer())
      .get(`/api/v1/inventory/manage/${variantId}`)
      .set("Cookie", staff.cookie)
      .expect(200)
      .expect(({ body }) => expect(body.quantityOnHand).toBe(1));

    await adjustment(randomUUID(), -2, "Remove too much stock").expect(409);
    const [balance] = await database.db
      .select()
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, variantId));
    expect(balance?.quantityOnHand).toBe(1);

    const [movements, audit] = await Promise.all([
      database.db
        .select()
        .from(inventoryStockMovement)
        .where(eq(inventoryStockMovement.variantId, variantId)),
      database.db
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.eventType, "inventory.stock_adjusted"),
            eq(auditEvent.subjectId, variantId),
          ),
        ),
    ]);
    expect(movements).toHaveLength(2);
    expect(audit).toHaveLength(2);
  });

  it("rejects integer overflow and safely replays a committed command after deactivation", async () => {
    const [command] = await database.db
      .select()
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, variantId));
    expect(command?.quantityOnHand).toBe(1);

    await database.db
      .update(inventoryStockBalance)
      .set({ quantityOnHand: 2_147_483_647 })
      .where(eq(inventoryStockBalance.variantId, variantId));
    await adjustment(randomUUID(), 1, "Reject stock integer overflow").expect(
      400,
    );
    const [afterOverflow] = await database.db
      .select()
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, variantId));
    expect(afterOverflow?.quantityOnHand).toBe(2_147_483_647);

    const commandId = randomUUID();
    const committed = await adjustment(
      commandId,
      -1,
      "Remove final test unit",
    ).expect(201);
    await database.db
      .update(catalogProductVariant)
      .set({ isActive: false })
      .where(eq(catalogProductVariant.id, variantId));

    await adjustment(commandId, -1, "Remove final test unit")
      .expect(201)
      .expect(committed.body);
    await request(app.getHttpServer())
      .get(`/api/v1/inventory/manage/${variantId}`)
      .set("Cookie", staff.cookie)
      .expect(404);
  });
});
