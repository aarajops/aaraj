import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
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
  inventoryStockReservation,
  inventoryReservationCommand,
} from "../src/inventory/inventory-schema.js";
import {
  INVENTORY_RESERVATION_PORT,
  type InventoryReservationPort,
} from "../src/inventory/inventory-reservation.port.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-inventory-e2e-password-123";

describe("variant inventory adjustments", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let reservations: InventoryReservationPort;
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

  function adjustmentFor(
    targetVariantId: string,
    commandId: string,
    delta: number,
    reason: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/inventory/manage/${targetVariantId}/adjustments`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ commandId, delta, reason });
  }

  function adjustment(commandId: string, delta: number, reason: string) {
    return adjustmentFor(variantId, commandId, delta, reason);
  }

  async function createApplication(): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const application = module.createNestApplication({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(application);
    await application.init();
    return application;
  }

  async function createPurchasableVariant(): Promise<string> {
    const [product] = await database.db
      .insert(catalogProduct)
      .values({
        slug: `inventory-reservation-${randomUUID()}`,
        name: "Inventory reservation E2E product",
        audience: "unisex",
        isPublished: true,
      })
      .returning();
    if (!product)
      throw new Error("Could not create the reservation test product.");

    const [variant] = await database.db
      .insert(catalogProductVariant)
      .values({
        productId: product.id,
        sku: `RSV-${randomUUID()}`,
        color: "Blue",
        sizeLabel: "M",
        priceBdt: 100,
      })
      .returning();
    if (!variant)
      throw new Error("Could not create the reservation test variant.");
    return variant.id;
  }

  async function receiveStock(targetVariantId: string, quantity: number) {
    await adjustmentFor(
      targetVariantId,
      randomUUID(),
      quantity,
      "Receive reservation test stock",
    ).expect(201);
  }

  async function readBalance(targetVariantId: string) {
    const [balance] = await database.db
      .select({
        quantityOnHand: inventoryStockBalance.quantityOnHand,
        quantityReserved: inventoryStockBalance.quantityReserved,
      })
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, targetVariantId));
    return balance ?? { quantityOnHand: 0, quantityReserved: 0 };
  }

  beforeAll(async () => {
    app = await createApplication();
    database = app.get(DatabaseService);
    reservations = app.get(INVENTORY_RESERVATION_PORT);

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
          quantityReserved: 0,
          quantityAvailable: 0,
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

  it("reserves single and multiple variants, aggregates duplicates, and replays commands", async () => {
    const singleVariantId = await createPurchasableVariant();
    await receiveStock(singleVariantId, 5);

    const command = {
      commandId: randomUUID(),
      lines: [
        { variantId: singleVariantId, quantity: 2 },
        { variantId: singleVariantId, quantity: 1 },
      ],
    };
    const [first, replay] = await Promise.all([
      reservations.reserve(command),
      reservations.reserve(command),
    ]);
    expect(first.id).toBe(replay.id);
    expect(first.status).toBe("held");
    expect(first.lines).toEqual([{ variantId: singleVariantId, quantity: 3 }]);
    expect(await readBalance(singleVariantId)).toEqual({
      quantityOnHand: 5,
      quantityReserved: 3,
    });
    await expect(
      reservations.reserve({
        ...command,
        lines: [{ variantId: singleVariantId, quantity: 4 }],
      }),
    ).rejects.toMatchObject({ status: 409 });

    const multiVariantIds = [
      await createPurchasableVariant(),
      await createPurchasableVariant(),
    ];
    await Promise.all(multiVariantIds.map((id) => receiveStock(id, 2)));
    const multi = await reservations.reserve({
      commandId: randomUUID(),
      lines: multiVariantIds.map((variantId) => ({ variantId, quantity: 1 })),
    });
    expect(multi.status).toBe("held");
    expect(multi.lines).toHaveLength(2);
    for (const id of multiVariantIds) {
      expect(await readBalance(id)).toEqual({
        quantityOnHand: 2,
        quantityReserved: 1,
      });
    }
  });

  it("rolls back every allocation when one variant is unavailable", async () => {
    const variantIds = [
      await createPurchasableVariant(),
      await createPurchasableVariant(),
    ].sort();
    const availableVariantId = variantIds[0];
    const unavailableVariantId = variantIds[1];
    if (!availableVariantId || !unavailableVariantId)
      throw new Error("Reservation rollback test needs two variants.");
    await receiveStock(availableVariantId, 2);

    const commandId = randomUUID();
    const reservationCountBefore = (
      await database.db
        .select({ id: inventoryStockReservation.id })
        .from(inventoryStockReservation)
    ).length;
    await expect(
      reservations.reserve({
        commandId,
        lines: [
          { variantId: availableVariantId, quantity: 1 },
          { variantId: unavailableVariantId, quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await readBalance(availableVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 0,
    });
    expect(await readBalance(unavailableVariantId)).toEqual({
      quantityOnHand: 0,
      quantityReserved: 0,
    });
    expect(
      await database.db
        .select()
        .from(inventoryReservationCommand)
        .where(eq(inventoryReservationCommand.commandId, commandId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select({ id: inventoryStockReservation.id })
        .from(inventoryStockReservation),
    ).toHaveLength(reservationCountBefore);
  });

  it("allows only one buyer to reserve the final unit", async () => {
    const finalUnitVariantId = await createPurchasableVariant();
    await receiveStock(finalUnitVariantId, 1);

    const results = await Promise.allSettled([
      reservations.reserve({
        commandId: randomUUID(),
        lines: [{ variantId: finalUnitVariantId, quantity: 1 }],
      }),
      reservations.reserve({
        commandId: randomUUID(),
        lines: [{ variantId: finalUnitVariantId, quantity: 1 }],
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: 409 });
    expect(await readBalance(finalUnitVariantId)).toEqual({
      quantityOnHand: 1,
      quantityReserved: 1,
    });
  });

  it("releases and consumes stock exactly once with guarded terminal states", async () => {
    const releaseVariantId = await createPurchasableVariant();
    await receiveStock(releaseVariantId, 4);
    const released = await reservations.reserve({
      commandId: randomUUID(),
      lines: [{ variantId: releaseVariantId, quantity: 2 }],
    });
    const releaseCommand = {
      commandId: randomUUID(),
      reservationId: released.id,
    };
    const [releaseResult, releaseReplay] = await Promise.all([
      reservations.release(releaseCommand),
      reservations.release(releaseCommand),
    ]);
    expect(releaseResult.id).toBe(releaseReplay.id);
    expect(releaseResult.status).toBe("released");
    expect(await readBalance(releaseVariantId)).toEqual({
      quantityOnHand: 4,
      quantityReserved: 0,
    });
    expect(
      (
        await reservations.release({
          commandId: randomUUID(),
          reservationId: released.id,
        })
      ).status,
    ).toBe("released");
    await expect(
      reservations.consume({
        commandId: randomUUID(),
        reservationId: released.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const consumeVariantId = await createPurchasableVariant();
    await receiveStock(consumeVariantId, 4);
    const held = await reservations.reserve({
      commandId: randomUUID(),
      lines: [{ variantId: consumeVariantId, quantity: 3 }],
    });
    const consumeCommand = {
      commandId: randomUUID(),
      reservationId: held.id,
    };
    const [consumeResult, consumeReplay] = await Promise.all([
      reservations.consume(consumeCommand),
      reservations.consume(consumeCommand),
    ]);
    expect(consumeResult.id).toBe(consumeReplay.id);
    expect(consumeResult.status).toBe("consumed");
    expect(await readBalance(consumeVariantId)).toEqual({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
    expect(
      (
        await reservations.consume({
          commandId: randomUUID(),
          reservationId: held.id,
        })
      ).status,
    ).toBe("consumed");
    await expect(
      reservations.release({
        commandId: randomUUID(),
        reservationId: held.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("serializes release versus consume and preserves stock invariants", async () => {
    const targetVariantId = await createPurchasableVariant();
    await receiveStock(targetVariantId, 2);
    const held = await reservations.reserve({
      commandId: randomUUID(),
      lines: [{ variantId: targetVariantId, quantity: 1 }],
    });

    const outcomes = await Promise.allSettled([
      reservations.release({
        commandId: randomUUID(),
        reservationId: held.id,
      }),
      reservations.consume({
        commandId: randomUUID(),
        reservationId: held.id,
      }),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ status: 409 });

    const state = await reservations.getReservation(held.id);
    expect(["released", "consumed"]).toContain(state?.status);
    const balance = await readBalance(targetVariantId);
    expect(balance.quantityReserved).toBe(0);
    expect(balance.quantityOnHand).toBe(state?.status === "consumed" ? 1 : 2);
  });

  it("prevents staff reductions from crossing actively reserved stock", async () => {
    const targetVariantId = await createPurchasableVariant();
    await receiveStock(targetVariantId, 3);
    const held = await reservations.reserve({
      commandId: randomUUID(),
      lines: [{ variantId: targetVariantId, quantity: 2 }],
    });

    await adjustmentFor(
      targetVariantId,
      randomUUID(),
      -2,
      "Remove reserved stock",
    ).expect(409);
    expect(await readBalance(targetVariantId)).toEqual({
      quantityOnHand: 3,
      quantityReserved: 2,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/inventory/manage/${targetVariantId}`)
      .set("Cookie", staff.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          quantityOnHand: 3,
          quantityReserved: 2,
          quantityAvailable: 1,
        }),
      );

    await adjustmentFor(
      targetVariantId,
      randomUUID(),
      -1,
      "Remove available stock",
    ).expect(201);
    expect(await readBalance(targetVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 2,
    });
    await reservations.release({
      commandId: randomUUID(),
      reservationId: held.id,
    });
    expect(await readBalance(targetVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 0,
    });
  });

  it("serializes a staff removal racing the reservation of the same final unit", async () => {
    const targetVariantId = await createPurchasableVariant();
    await receiveStock(targetVariantId, 1);
    const reservationCommand = {
      commandId: randomUUID(),
      lines: [{ variantId: targetVariantId, quantity: 1 }],
    };
    const [reserveOutcome, adjustmentOutcome] = await Promise.all([
      reservations.reserve(reservationCommand).then(
        (reservation) => ({ kind: "reserved" as const, reservation }),
        (error: unknown) => ({ kind: "reserve-rejected" as const, error }),
      ),
      adjustmentFor(
        targetVariantId,
        randomUUID(),
        -1,
        "Remove final unit during reservation",
      ).then(({ status }) => ({ kind: "adjustment" as const, status })),
    ]);

    if (reserveOutcome.kind === "reserved") {
      expect(adjustmentOutcome).toMatchObject({ status: 409 });
      expect(reserveOutcome.reservation.status).toBe("held");
      expect(await readBalance(targetVariantId)).toEqual({
        quantityOnHand: 1,
        quantityReserved: 1,
      });
    } else {
      expect(reserveOutcome.error).toMatchObject({ status: 409 });
      expect(adjustmentOutcome).toMatchObject({ status: 201 });
      expect(await readBalance(targetVariantId)).toEqual({
        quantityOnHand: 0,
        quantityReserved: 0,
      });
    }
  });

  it("rolls back allocations when PostgreSQL fails during a multi-variant reserve", async () => {
    const variantIds = [
      await createPurchasableVariant(),
      await createPurchasableVariant(),
    ].sort();
    const firstVariantId = variantIds[0];
    const failingVariantId = variantIds[1];
    if (!firstVariantId || !failingVariantId)
      throw new Error("Database failure test needs two variants.");
    await Promise.all([
      receiveStock(firstVariantId, 2),
      receiveStock(failingVariantId, 2),
    ]);

    const constraintName = "inventory_e2e_reservation_failure_check";
    await database.db.execute(
      sql.raw(
        `ALTER TABLE inventory.stock_balance ADD CONSTRAINT ${constraintName} CHECK (variant_id <> '${failingVariantId}'::uuid OR quantity_reserved = 0)`,
      ),
    );
    const commandId = randomUUID();
    try {
      await expect(
        reservations.reserve({
          commandId,
          lines: [
            { variantId: firstVariantId, quantity: 1 },
            { variantId: failingVariantId, quantity: 1 },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      await database.db.execute(
        sql.raw(
          `ALTER TABLE inventory.stock_balance DROP CONSTRAINT IF EXISTS ${constraintName}`,
        ),
      );
    }

    expect(await readBalance(firstVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 0,
    });
    expect(await readBalance(failingVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 0,
    });
    expect(
      await database.db
        .select()
        .from(inventoryReservationCommand)
        .where(eq(inventoryReservationCommand.commandId, commandId)),
    ).toHaveLength(0);
  });

  it("replays a committed reservation after the Inventory service restarts", async () => {
    const targetVariantId = await createPurchasableVariant();
    await receiveStock(targetVariantId, 2);
    const command = {
      commandId: randomUUID(),
      lines: [{ variantId: targetVariantId, quantity: 1 }],
    };
    const committed = await reservations.reserve(command);

    await app.close();
    app = await createApplication();
    database = app.get(DatabaseService);
    reservations = app.get(INVENTORY_RESERVATION_PORT);

    const replay = await reservations.reserve(command);
    expect(replay.id).toBe(committed.id);
    expect(replay.status).toBe("held");
    expect(await readBalance(targetVariantId)).toEqual({
      quantityOnHand: 2,
      quantityReserved: 1,
    });
  });
});
