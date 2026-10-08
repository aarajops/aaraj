import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach } from "vitest";
import {
  API_V1_BASE_PATH,
  ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS,
  type BangladeshGeography,
  type CreateOrderInput,
} from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import {
  catalogProduct,
  catalogProductVariant,
} from "../src/catalog/catalog-schema.js";
import { bangladeshBusinessDate } from "../src/delivery/delivery.service.js";
import { deliveryTariff } from "../src/delivery/delivery-schema.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import {
  inventoryReservationCommand,
  inventoryStockBalance,
  inventoryStockReservation,
} from "../src/inventory/inventory-schema.js";
import {
  INVENTORY_RESERVATION_PORT,
  type InventoryReservationPort,
} from "../src/inventory/inventory-reservation.port.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import {
  customerOrder,
  orderIdempotency,
} from "../src/orders/orders-schema.js";
import { OrdersService } from "../src/orders/orders.service.js";
import { quoteSnapshot } from "../src/quote/quote-schema.js";
import { taxProfile } from "../src/tax/tax-schema.js";

const origin = "http://localhost:3000";
const password = "aaraj-orders-e2e-password-123";
const cartCookieName = "aaraj_guest_cart";
const execFileAsync = promisify(execFile);

type Account = { id: string; cookie: string };
type GuestCart = { cookie: string; revision: number };
type Destination = {
  geographyVersion: string;
  divisionId: string;
  districtId: string;
  upazilaId?: string;
};

describe("COD Orders and checkout", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let staff: Account;
  let customer: Account;
  let geography: BangladeshGeography;
  let dhaka: BangladeshGeography["locations"][number];
  let dhakaDivision: BangladeshGeography["locations"][number];

  async function account(name: string): Promise<Account> {
    const response = await auth.api.signUpEmail({
      body: {
        name,
        email: `${name}-${randomUUID()}@orders-e2e.example`,
        password,
      },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  async function createVariant(stock = 0, price = 250): Promise<string> {
    const [product] = await database.db
      .insert(catalogProduct)
      .values({
        slug: `order-${randomUUID()}`,
        name: `Order E2E product ${randomUUID().slice(0, 8)}`,
        audience: "unisex",
        isPublished: true,
      })
      .returning();
    if (!product) throw new Error("Could not create an Order test product.");
    const [variant] = await database.db
      .insert(catalogProductVariant)
      .values({
        productId: product.id,
        sku: `ORDER-${randomUUID()}`,
        color: "Blue",
        sizeLabel: "M",
        priceBdt: price,
      })
      .returning({ id: catalogProductVariant.id });
    if (!variant) throw new Error("Could not create an Order test variant.");
    if (stock > 0) {
      await database.db.insert(inventoryStockBalance).values({
        variantId: variant.id,
        quantityOnHand: stock,
        quantityReserved: 0,
      });
    }
    return variant.id;
  }

  async function newGuestCart(
    variantIds: readonly string[],
    quantity = 1,
  ): Promise<GuestCart> {
    let cart: GuestCart = { cookie: "", revision: 0 };
    for (const variantId of variantIds) {
      const response = await request(app.getHttpServer())
        .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
        .set("Origin", origin)
        .set("Cookie", cart.cookie)
        .send({ revision: cart.revision, quantity })
        .expect(200);
      const setCookie = setCookieHeaders(response.headers).find((value) =>
        value.startsWith(`${cartCookieName}=`),
      );
      if (setCookie) cart.cookie = setCookie.split(";")[0]!;
      if (!cart.cookie) throw new Error("Guest cart cookie was not issued.");
      cart.revision = response.body.revision as number;
    }
    return cart;
  }

  async function addCustomerLines(variantIds: readonly string[], quantity = 1) {
    let revision = 0;
    for (const variantId of variantIds) {
      const response = await request(app.getHttpServer())
        .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
        .set("Origin", origin)
        .set("Cookie", customer.cookie)
        .send({ revision, quantity })
        .expect(200);
      revision = response.body.revision as number;
    }
  }

  async function createQuote(
    cookie: string,
    destination: Destination = destinationRef(),
  ) {
    const cart = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send(destination)
      .expect(201);
    return cart.body as { id: string; totalBdt: number; cartRevision: number };
  }

  async function prepareGuestCheckout(
    cookie: string,
    idempotencyKey: string,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/checkout-access`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("Idempotency-Key", idempotencyKey)
      .expect(204);
    const attemptCookie = setCookieHeaders(response.headers).find((value) =>
      value.startsWith(`aaraj_order_attempt_${idempotencyKey}=`),
    );
    if (!attemptCookie) {
      throw new Error("Guest checkout access cookie was not issued.");
    }
    return `${cookie}; ${attemptCookie.split(";")[0]}`;
  }

  function destinationRef(): Destination {
    return {
      geographyVersion: geography.datasetVersion,
      divisionId: dhakaDivision.id,
      districtId: dhaka.id,
    };
  }

  function checkoutBody(
    quoteId: string,
    extra: Partial<CreateOrderInput["address"]> = {},
  ): CreateOrderInput {
    return {
      quoteId,
      address: {
        recipientName: "E2E Recipient",
        phone: "01712345678",
        ...destinationRef(),
        locality: "Dhanmondi",
        doorstepDetails: "House 12, Road 5, near the park",
        ...extra,
      },
    };
  }

  function placeOrder(
    cookie: string,
    input: CreateOrderInput,
    key = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("Idempotency-Key", key)
      .send(input);
  }

  async function stockFor(variantId: string) {
    const [stock] = await database.db
      .select()
      .from(inventoryStockBalance)
      .where(eq(inventoryStockBalance.variantId, variantId));
    return stock ?? { quantityOnHand: 0, quantityReserved: 0 };
  }

  async function orderById(id: string) {
    const [row] = await database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.id, id));
    return row;
  }

  async function createGuestOrder(stock = 2) {
    const variantId = await createVariant(stock);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const response = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    const orderCookie = setCookieHeaders(response.headers).find((value) =>
      value.startsWith(`aaraj_order_${response.body.id}=`),
    );
    if (!orderCookie) throw new Error("Guest Order cookie was not issued.");
    const stored = await orderById(response.body.id);
    if (!stored) throw new Error("Guest Order fixture was not saved.");
    return {
      id: response.body.id as string,
      cookie: orderCookie.split(";")[0]!,
      variantId,
      reservationId: stored.reservationId,
    };
  }

  async function setOrderAge(orderId: string, ageHours: number, seconds = 0) {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`ALTER TABLE orders.order_header DISABLE TRIGGER order_header_protect_update`,
      );
      try {
        await transaction.execute(sql`
          WITH fixture_time AS (
            SELECT clock_timestamp() - ${ageHours} * interval '1 hour' + ${seconds} * interval '1 second' AS created_at
          )
          UPDATE orders.order_header AS order_row
          SET created_at = fixture_time.created_at,
              guest_access_expires_at = fixture_time.created_at + interval '30 days',
              updated_at = clock_timestamp()
          FROM fixture_time
          WHERE order_row.id = ${orderId}::uuid
        `);
      } finally {
        await transaction.execute(
          sql`ALTER TABLE orders.order_header ENABLE TRIGGER order_header_protect_update`,
        );
      }
    });
  }

  async function setReviewDeadlineOffset(orderId: string, seconds: number) {
    await setOrderAge(
      orderId,
      ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS,
      seconds,
    );
  }

  async function createLegacy48HourCancellation(fixture: {
    id: string;
    reservationId: string;
  }) {
    const inventory = app.get<InventoryReservationPort>(
      INVENTORY_RESERVATION_PORT,
    );
    const audit = app.get(AuditService);
    await database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`ALTER TABLE orders.order_header DISABLE TRIGGER order_header_protect_update`,
      );
      try {
        const cancellation = await transaction.execute<{
          cancelled_at: string | Date;
        }>(sql`
          WITH fixture_time AS (
            SELECT clock_timestamp() - interval '48 hours' AS created_at
          )
          UPDATE orders.order_header AS order_row
          SET created_at = fixture_time.created_at,
              guest_access_expires_at = fixture_time.created_at + interval '30 days',
              status = 'cancelled',
              fulfillment_status = 'cancelled',
              cancellation_reason = 'serviceability_review_timeout',
              cancelled_at = clock_timestamp(),
              updated_at = clock_timestamp()
          FROM fixture_time
          WHERE order_row.id = ${fixture.id}::uuid
          RETURNING order_row.cancelled_at
        `);
        const cancelled = cancellation.rows[0];
        if (!cancelled?.cancelled_at)
          throw new Error("Legacy cancellation fixture could not be created.");
        const cancelledAt = new Date(cancelled.cancelled_at);
        await inventory.releaseWithinTransaction(transaction, {
          commandId: randomUUID(),
          reservationId: fixture.reservationId,
        });
        await audit.append(transaction, {
          actorType: "service",
          eventType: "commerce.cod_order_manual_review_timeout_cancelled",
          subjectType: "order",
          subjectId: fixture.id,
          occurredAt: cancelledAt,
          reason: "Serviceability was not reviewed within 48 hours.",
          metadata: {
            cancellationReason: "serviceability_review_timeout",
            reviewDeadlineHours: 48,
            reservationId: fixture.reservationId,
          },
        });
      } finally {
        await transaction.execute(
          sql`ALTER TABLE orders.order_header ENABLE TRIGGER order_header_protect_update`,
        );
      }
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({
      bodyParser: false,
      logger: ["error"],
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    const bootstrap = await account("order-superadmin");
    staff = await account("order-staff");
    customer = await account("order-customer");
    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(bootstrap.id, {
      reason: "Order E2E bootstrap",
    });
    await access.changeRole(bootstrap, staff.id, "staff", "grant", {
      reason: "COD serviceability review E2E operator",
    });
    const geographyResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/geography`)
      .expect(200);
    geography = geographyResponse.body as BangladeshGeography;
    dhaka = geography.locations.find(
      (location) =>
        location.level === "district" && location.name === "ঢাকা জেলা",
    )!;
    dhakaDivision = geography.locations.find(
      (location) => location.id === dhaka.parentId,
    )!;
    if (!dhaka || !dhakaDivision)
      throw new Error("Dhaka geography fixture is missing.");
  });

  beforeEach(async () => {
    const date = bangladeshBusinessDate();
    await database.db
      .update(deliveryTariff)
      .set({ effectiveFrom: date, effectiveTo: null })
      .where(eq(deliveryTariff.version, "AARAJ_DELIVERY_2026_10_07_V1"));
    const tomorrow = new Date(`${date}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    await database.db
      .update(deliveryTariff)
      .set({ effectiveFrom: tomorrowDate, effectiveTo: null })
      .where(
        eq(
          deliveryTariff.version,
          `AARAJ_DELIVERY_${date.replaceAll("-", "_")}_V2`,
        ),
      );
    await database.db
      .update(taxProfile)
      .set({ effectiveFrom: "2020-01-01", effectiveTo: null })
      .where(eq(taxProfile.version, "TEST_ONLY_BD_RETAIL_TAX_RULE_V1"));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("places guest COD orders with a private 30-day order-scoped cookie and atomic held stock", async () => {
    const variantId = await createVariant(2);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const response = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    expect(response.body).toMatchObject({
      reference: expect.stringMatching(/^AA-[0-9A-F]{12}$/),
      status: "awaiting_confirmation",
      serviceability: "pending_manual_review",
      paymentMethod: "cod",
      collectionStatus: "uncollected",
      fulfillmentStatus: "not_started",
      codAmountDueBdt: quote.totalBdt,
      replayed: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("01712345678");
    const cookieValue = setCookieHeaders(response.headers).find((value) =>
      value.startsWith(`aaraj_order_${response.body.id}=`),
    );
    expect(cookieValue).toContain("HttpOnly");
    expect(cookieValue?.toLowerCase()).toContain("samesite=lax");
    expect(cookieValue).toContain(`/api/v1/orders/${response.body.id}`);
    const guestCookie = cookieValue!.split(";")[0]!;
    expect(setCookieHeaders(response.headers)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`aaraj_order_attempt_${key}=`),
      ]),
    );
    const stored = await orderById(response.body.id);
    expect(stored?.guestAccessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.addressCiphertext).not.toContain("E2E Recipient");
    expect(stored?.addressCiphertext).toMatch(/^v1\./);
    const [expiry] = await database.db
      .select({
        days: sql<number>`extract(epoch from (${customerOrder.guestAccessExpiresAt} - ${customerOrder.createdAt})) / 86400`,
      })
      .from(customerOrder)
      .where(eq(customerOrder.id, response.body.id));
    expect(Number(expiry?.days)).toBe(30);
    expect(await stockFor(variantId)).toEqual({
      variantId,
      quantityOnHand: 2,
      quantityReserved: 1,
      updatedAt: expect.any(Date),
    });
    const reservation = await database.db
      .select()
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, stored!.reservationId));
    expect(reservation[0]?.status).toBe("held");
    const privateOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${response.body.id}`)
      .set("Cookie", guestCookie)
      .expect(200);
    expect(privateOrder.body.address).toMatchObject({
      recipientName: "E2E Recipient",
      phone: "+8801712345678",
    });
    expect(
      setCookieHeaders(response.headers).find((value) =>
        value.startsWith(`aaraj_order_attempt_${key}=`),
      ),
    ).toMatch(new RegExp(`^aaraj_order_attempt_${key}=;`));
    const replay = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/checkout/replay`)
      .set("Origin", origin)
      .set("Cookie", checkoutCookie)
      .set("Idempotency-Key", key)
      .expect(200);
    expect(replay.body).toMatchObject({ id: response.body.id, replayed: true });
    expect((await stockFor(variantId)).quantityReserved).toBe(1);
  });

  it("creates an authenticated Order owned by the signed-in customer", async () => {
    const variantId = await createVariant(1);
    await addCustomerLines([variantId]);
    const quote = await createQuote(customer.cookie);
    const response = await placeOrder(
      customer.cookie,
      checkoutBody(quote.id),
    ).expect(201);
    expect(setCookieHeaders(response.headers)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("aaraj_order_")]),
    );
    expect((await orderById(response.body.id))?.customerId).toBe(customer.id);
    expect((await stockFor(variantId)).quantityReserved).toBe(1);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${response.body.id}`)
      .set("Cookie", customer.cookie)
      .expect(200);
  });

  it("serializes competing checkouts for the final unit so one wins", async () => {
    const variantId = await createVariant(1);
    const firstCart = await newGuestCart([variantId]);
    const secondCart = await newGuestCart([variantId]);
    const firstQuote = await createQuote(firstCart.cookie);
    const secondQuote = await createQuote(secondCart.cookie);
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const firstCookie = await prepareGuestCheckout(firstCart.cookie, firstKey);
    const secondCookie = await prepareGuestCheckout(
      secondCart.cookie,
      secondKey,
    );
    const [first, second] = await Promise.all([
      placeOrder(firstCookie, checkoutBody(firstQuote.id), firstKey),
      placeOrder(secondCookie, checkoutBody(secondQuote.id), secondKey),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect((await stockFor(variantId)).quantityReserved).toBe(1);
    const acceptedCount = await database.db
      .select({ count: sql<number>`count(*)` })
      .from(customerOrder)
      .where(inArray(customerOrder.quoteId, [firstQuote.id, secondQuote.id]));
    expect(Number(acceptedCount[0]?.count)).toBe(1);
  });

  it("rolls back every line and the Order if any variant lacks stock", async () => {
    const availableVariant = await createVariant(1);
    const shortVariant = await createVariant(0);
    const cart = await newGuestCart([availableVariant, shortVariant]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    await placeOrder(checkoutCookie, checkoutBody(quote.id), key).expect(409);
    expect((await stockFor(availableVariant)).quantityReserved).toBe(0);
    expect((await stockFor(shortVariant)).quantityReserved).toBe(0);
    expect(
      await database.db
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.quoteId, quote.id)),
    ).toHaveLength(0);
  });

  it("returns one Order for repeated idempotent submissions and conflicts on changed payload", async () => {
    const variantId = await createVariant(3);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const input = checkoutBody(quote.id);
    const [first, duplicate] = await Promise.all([
      placeOrder(checkoutCookie, input, key),
      placeOrder(checkoutCookie, input, key),
    ]);
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(201);
    expect(first.body.id).toBe(duplicate.body.id);
    expect(
      [first.body.replayed, duplicate.body.replayed].sort(
        (a, b) => Number(a) - Number(b),
      ),
    ).toEqual([false, true]);
    expect((await stockFor(variantId)).quantityReserved).toBe(1);
    await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id, { locality: "Gulshan" }),
      key,
    ).expect(409);
    expect(
      await database.db
        .select()
        .from(orderIdempotency)
        .where(eq(orderIdempotency.orderId, first.body.id)),
    ).toHaveLength(1);
  });

  it("rejects stale, expired and cart-changed quotes without reserving stock", async () => {
    const staleVariant = await createVariant(2);
    const staleCart = await newGuestCart([staleVariant]);
    const staleQuote = await createQuote(staleCart.cookie);
    const staleKey = randomUUID();
    const staleCookie = await prepareGuestCheckout(staleCart.cookie, staleKey);
    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 999 })
      .where(eq(catalogProductVariant.id, staleVariant));
    await placeOrder(staleCookie, checkoutBody(staleQuote.id), staleKey).expect(
      409,
    );
    expect((await stockFor(staleVariant)).quantityReserved).toBe(0);

    const expiredVariant = await createVariant(2);
    const expiredCart = await newGuestCart([expiredVariant]);
    const expiredQuote = await createQuote(expiredCart.cookie);
    const expiredKey = randomUUID();
    const expiredCookie = await prepareGuestCheckout(
      expiredCart.cookie,
      expiredKey,
    );
    const [sourceQuote] = await database.db
      .select()
      .from(quoteSnapshot)
      .where(eq(quoteSnapshot.id, expiredQuote.id));
    if (!sourceQuote) throw new Error("Quote fixture is missing.");
    const { id: _sourceQuoteId, ...expiredSnapshot } = sourceQuote;
    const [pastQuote] = await database.db
      .insert(quoteSnapshot)
      .values({
        ...expiredSnapshot,
        createdAt: new Date(Date.now() - 16 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning({ id: quoteSnapshot.id });
    if (!pastQuote)
      throw new Error("Expired quote fixture could not be created.");
    await placeOrder(
      expiredCookie,
      checkoutBody(pastQuote.id),
      expiredKey,
    ).expect(409);
    expect((await stockFor(expiredVariant)).quantityReserved).toBe(0);

    const changedVariant = await createVariant(2);
    const changedCart = await newGuestCart([changedVariant]);
    const changedQuote = await createQuote(changedCart.cookie);
    const changedKey = randomUUID();
    const changedCookie = await prepareGuestCheckout(
      changedCart.cookie,
      changedKey,
    );
    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${changedVariant}`)
      .set("Origin", origin)
      .set("Cookie", changedCart.cookie)
      .send({ revision: changedCart.revision, quantity: 2 })
      .expect(200);
    await placeOrder(
      changedCookie,
      checkoutBody(changedQuote.id),
      changedKey,
    ).expect(409);
    expect((await stockFor(changedVariant)).quantityReserved).toBe(0);
  });

  it("rejects invalid Bangladesh addresses and geography without creating an Order", async () => {
    const variantId = await createVariant(2);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const invalidPhoneKey = randomUUID();
    const invalidPhoneCookie = await prepareGuestCheckout(
      cart.cookie,
      invalidPhoneKey,
    );
    await placeOrder(
      invalidPhoneCookie,
      checkoutBody(quote.id, { phone: "1234567" }),
      invalidPhoneKey,
    ).expect(422);
    const invalidGeographyKey = randomUUID();
    const invalidGeographyCookie = await prepareGuestCheckout(
      cart.cookie,
      invalidGeographyKey,
    );
    await placeOrder(
      invalidGeographyCookie,
      checkoutBody(quote.id, { districtId: randomUUID() }),
      invalidGeographyKey,
    ).expect(400);
    expect(
      await database.db
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.quoteId, quote.id)),
    ).toHaveLength(0);
    expect((await stockFor(variantId)).quantityReserved).toBe(0);
  });

  it("hides guest Orders from other owners and denies access without the order cookie", async () => {
    const variantId = await createVariant(1);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const created = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${created.body.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${created.body.id}`)
      .set("Cookie", customer.cookie)
      .expect(404);
  });

  it("does not recreate or recover guest access after its credential is lost", async () => {
    const variantId = await createVariant(1);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    await placeOrder(checkoutCookie, checkoutBody(quote.id), key).expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/checkout-access`)
      .set("Origin", origin)
      .set("Cookie", cart.cookie)
      .set("Idempotency-Key", key)
      .expect(409)
      .expect(({ body }) => {
        expect(body.errorCode).toBe("ORDER_ACCESS_UNAVAILABLE");
      });
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/checkout/replay`)
      .set("Origin", origin)
      .set("Cookie", cart.cookie)
      .set("Idempotency-Key", key)
      .expect(409)
      .expect(({ body }) => {
        expect(body.errorCode).toBe("ORDER_ACCESS_UNAVAILABLE");
      });
  });

  it("keeps Order prices immutable after Catalog price changes and never consumes stock on creation", async () => {
    const variantId = await createVariant(2, 333);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const created = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 777 })
      .where(eq(catalogProductVariant.id, variantId));
    const cookieValue = setCookieHeaders(created.headers)
      .find((value) => value.startsWith(`aaraj_order_${created.body.id}=`))!
      .split(";")[0]!;
    const privateOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${created.body.id}`)
      .set("Cookie", cookieValue)
      .expect(200);
    expect(privateOrder.body.lines[0].unitPriceBdt).toBe(333);
    expect(privateOrder.body.totalBdt).toBe(quote.totalBdt);
    expect((await stockFor(variantId)).quantityOnHand).toBe(2);
    expect((await stockFor(variantId)).quantityReserved).toBe(1);
    expect(privateOrder.body.collectionStatus).toBe("uncollected");
    expect(privateOrder.body.fulfillmentStatus).toBe("not_started");
  });

  it("does not let a synthetic test tax profile authorize production checkout", async () => {
    const variantId = await createVariant(1);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const priorMode = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await placeOrder(checkoutCookie, checkoutBody(quote.id), key).expect(503);
    } finally {
      process.env.NODE_ENV = priorMode;
    }
    expect((await stockFor(variantId)).quantityReserved).toBe(0);
    expect(
      await database.db
        .select()
        .from(customerOrder)
        .where(eq(customerOrder.quoteId, quote.id)),
    ).toHaveLength(0);
  });

  it("authorizes staff manual serviceability decisions and releases stock on rejection", async () => {
    const variantId = await createVariant(2);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const created = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/manage`)
      .set("Cookie", customer.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/orders/manage/${created.body.id}/serviceability`,
      )
      .set("Origin", origin)
      .set("Cookie", customer.cookie)
      .send({ outcome: "serviceable", reason: "Destination can be served" })
      .expect(403);
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/orders/manage/${created.body.id}/serviceability`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({ outcome: "unserviceable", reason: "Courier does not cover area" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe("rejected");
        expect(body.serviceability).toBe("unserviceable");
        expect(body.fulfillmentStatus).toBe("cancelled");
      });
    expect((await stockFor(variantId)).quantityReserved).toBe(0);
  });

  it("uses separate guest Order cookies for multiple Orders and never extends access on reads", async () => {
    const variantId = await createVariant(3);
    const cart = await newGuestCart([variantId]);
    const firstQuote = await createQuote(cart.cookie);
    const firstKey = randomUUID();
    const firstCheckoutCookie = await prepareGuestCheckout(
      cart.cookie,
      firstKey,
    );
    const first = await placeOrder(
      firstCheckoutCookie,
      checkoutBody(firstQuote.id),
      firstKey,
    ).expect(201);
    const firstCookie = setCookieHeaders(first.headers)
      .find((value) => value.startsWith(`aaraj_order_${first.body.id}=`))!
      .split(";")[0]!;
    const secondCart = await newGuestCart([variantId]);
    const secondQuote = await createQuote(secondCart.cookie);
    const secondKey = randomUUID();
    const secondCheckoutCookie = await prepareGuestCheckout(
      secondCart.cookie,
      secondKey,
    );
    const second = await placeOrder(
      secondCheckoutCookie,
      checkoutBody(secondQuote.id),
      secondKey,
    ).expect(201);
    const secondCookie = setCookieHeaders(second.headers)
      .find((value) => value.startsWith(`aaraj_order_${second.body.id}=`))!
      .split(";")[0]!;
    expect(first.body.id).not.toBe(second.body.id);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${first.body.id}`)
      .set("Cookie", firstCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${second.body.id}`)
      .set("Cookie", secondCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${second.body.id}`)
      .set("Cookie", firstCookie)
      .expect(404);
    const expiresBefore = (await orderById(
      first.body.id,
    ))!.guestAccessExpiresAt!.getTime();
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${first.body.id}`)
      .set("Cookie", firstCookie)
      .expect(200);
    expect(
      (await orderById(first.body.id))!.guestAccessExpiresAt!.getTime(),
    ).toBe(expiresBefore);
  });

  it("keeps pending review Orders pending after 48 hours", async () => {
    const fixture = await createGuestOrder();
    await setOrderAge(fixture.id, 48);

    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);
    expect((await orderById(fixture.id))?.status).toBe("awaiting_confirmation");
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
  });

  it("keeps a pending Order immediately before the seven-day deadline", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, 30);

    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);
    expect((await orderById(fixture.id))?.status).toBe("awaiting_confirmation");
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
  });

  it("expires at the seven-day PostgreSQL deadline and records 168 hours", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, 0);
    const orders = app.get(OrdersService);

    expect(await orders.expirePendingServiceabilityReviews()).toBe(1);
    const stored = await orderById(fixture.id);
    expect(stored).toMatchObject({
      status: "cancelled",
      cancellationReason: "serviceability_review_timeout",
    });
    const deadlineCheck = await database.db.execute<{ valid: boolean }>(sql`
      SELECT cancelled_at >= created_at + ${ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS} * interval '1 hour' AS valid
      FROM orders.order_header
      WHERE id = ${fixture.id}::uuid
    `);
    expect(deadlineCheck.rows[0]?.valid).toBe(true);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    expect(await orders.expirePendingServiceabilityReviews()).toBe(0);
    const releaseCommands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(
      releaseCommands.filter((command) => command.operation === "release"),
    ).toHaveLength(1);
    const timeoutEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, fixture.id));
    expect(
      timeoutEvents.find(
        (event) =>
          event.eventType ===
          "commerce.cod_order_manual_review_timeout_cancelled",
      )?.metadata,
    ).toMatchObject({ reviewDeadlineHours: 168 });
  });

  it("turns staff review at or after the deadline into the expiry outcome", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, -1);

    const reviewed = await app
      .get(OrdersService)
      .reviewServiceability(fixture.id, staff.id, {
        outcome: "serviceable",
        reason: "Destination can be served",
      });

    expect(reviewed.status).toBe("cancelled");
    expect(reviewed.cancellationReason).toBe("serviceability_review_timeout");
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);
  });

  it.each(["confirmed", "rejected"] as const)(
    "prevents a direct database %s transition after the review deadline",
    async (status) => {
      const fixture = await createGuestOrder();
      await setReviewDeadlineOffset(fixture.id, -1);
      const reviewValues =
        status === "confirmed"
          ? {
              status,
              serviceability: "serviceable" as const,
              fulfillmentStatus: "awaiting_dispatch" as const,
            }
          : {
              status,
              serviceability: "unserviceable" as const,
              fulfillmentStatus: "cancelled" as const,
            };

      let transitionError: unknown;
      try {
        await database.db
          .update(customerOrder)
          .set(reviewValues)
          .where(eq(customerOrder.id, fixture.id));
      } catch (error) {
        transitionError = error;
      }
      expect(transitionError).toMatchObject({
        cause: {
          message: expect.stringContaining(
            "Staff serviceability review must be completed before 7 days",
          ),
        },
      });
      expect((await orderById(fixture.id))?.status).toBe(
        "awaiting_confirmation",
      );
      expect(
        (
          await app
            .get(OrdersService)
            .reviewServiceability(fixture.id, staff.id, {
              outcome: status === "confirmed" ? "serviceable" : "unserviceable",
              reason: "The review deadline has passed",
            })
        ).status,
      ).toBe("cancelled");
    },
  );

  it("does not restore a legacy Order cancelled under the 48-hour policy", async () => {
    const fixture = await createGuestOrder();
    await createLegacy48HourCancellation(fixture);
    const before = await orderById(fixture.id);

    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);
    const after = await orderById(fixture.id);
    expect(after?.status).toBe("cancelled");
    expect(after?.cancelledAt).toEqual(before?.cancelledAt);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    const releaseCommands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(
      releaseCommands.filter((command) => command.operation === "release"),
    ).toHaveLength(1);
    const visibleOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(visibleOrder.body.status).toBe("cancelled");
  });

  it("expires a pending Order after restart, releases stock once, and exposes cancellation to its guest", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, -1);
    const beforeExpiry = await orderById(fixture.id);

    // A fresh API process and worker have no in-memory knowledge of this Order.
    await database.onApplicationShutdown();
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./order-expiry-worker-process.mjs", import.meta.url),
        ),
      ],
      { env: process.env, timeout: 15_000 },
    );
    expect(stdout.trim()).toBe("1");
    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);

    const visibleOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(visibleOrder.body).toMatchObject({
      status: "cancelled",
      serviceability: "pending_manual_review",
      fulfillmentStatus: "cancelled",
      cancellationReason: "serviceability_review_timeout",
      cancelledAt: expect.any(String),
    });
    const afterExpiry = await orderById(fixture.id);
    expect(afterExpiry).toMatchObject({
      addressCiphertext: beforeExpiry?.addressCiphertext,
      guestAccessTokenHash: beforeExpiry?.guestAccessTokenHash,
      guestAccessExpiresAt: beforeExpiry?.guestAccessExpiresAt,
      merchandiseGrossBdt: beforeExpiry?.merchandiseGrossBdt,
      deliveryAmountBdt: beforeExpiry?.deliveryAmountBdt,
      totalBdt: beforeExpiry?.totalBdt,
      codAmountDueBdt: beforeExpiry?.codAmountDueBdt,
      taxSnapshot: beforeExpiry?.taxSnapshot,
      deliverySnapshot: beforeExpiry?.deliverySnapshot,
    });
    const restoredStock = await stockFor(fixture.variantId);
    expect(restoredStock.quantityReserved).toBe(0);
    expect(restoredStock.quantityOnHand).toBe(2);
    expect(restoredStock.quantityOnHand - restoredStock.quantityReserved).toBe(
      2,
    );
    const releaseCommands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(
      releaseCommands.filter((command) => command.operation === "release"),
    ).toHaveLength(1);
    const timeoutEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, fixture.id));
    const timeoutTransitions = timeoutEvents.filter(
      (event) =>
        event.eventType ===
        "commerce.cod_order_manual_review_timeout_cancelled",
    );
    expect(timeoutTransitions).toHaveLength(1);
    const [timeoutEvent] = timeoutTransitions;
    expect(timeoutEvent?.occurredAt.getTime()).toBe(
      afterExpiry?.cancelledAt?.getTime(),
    );
    expect(timeoutEvent?.metadata).toMatchObject({
      reviewDeadlineHours: ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS,
    });
    const [reservation] = await database.db
      .select()
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, fixture.reservationId));
    expect(reservation?.status).toBe("released");
  });

  it("allows staff approval before the deadline and leaves its reservation held", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, 30);

    const reviewed = await app
      .get(OrdersService)
      .reviewServiceability(fixture.id, staff.id, {
        outcome: "serviceable",
        reason: "Destination can be served",
      });
    expect(reviewed.status).toBe("confirmed");
    expect(reviewed.cancellationReason).toBeNull();
    await setReviewDeadlineOffset(fixture.id, -1);
    expect(
      await app.get(OrdersService).expirePendingServiceabilityReviews(),
    ).toBe(0);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
    expect((await orderById(fixture.id))?.status).toBe("confirmed");
  });

  it.each(["serviceable", "unserviceable"] as const)(
    "serializes %s staff review against timeout so an expired Order has one final outcome",
    async (outcome) => {
      const fixture = await createGuestOrder();
      await setReviewDeadlineOffset(fixture.id, -1);
      const orders = app.get(OrdersService);
      const [review, expiryCount] = await Promise.allSettled([
        orders.reviewServiceability(fixture.id, staff.id, {
          outcome,
          reason:
            outcome === "serviceable"
              ? "Destination can be served"
              : "Courier does not cover area",
        }),
        orders.expirePendingServiceabilityReviews(),
      ]);

      expect(expiryCount.status).toBe("fulfilled");
      expect((await orderById(fixture.id))?.status).toBe("cancelled");
      if (review.status === "fulfilled") {
        expect(review.value.status).toBe("cancelled");
      } else {
        expect(review.reason).toBeInstanceOf(ConflictException);
      }
      expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
      const releaseCommands = await database.db
        .select()
        .from(inventoryReservationCommand)
        .where(
          eq(inventoryReservationCommand.reservationId, fixture.reservationId),
        );
      expect(
        releaseCommands.filter((command) => command.operation === "release"),
      ).toHaveLength(1);
      const timeoutEvents = await database.db
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.subjectId, fixture.id));
      expect(
        timeoutEvents.filter(
          (event) =>
            event.eventType ===
            "commerce.cod_order_manual_review_timeout_cancelled",
        ),
      ).toHaveLength(1);
    },
  );

  it("claims duplicate expiry work once across concurrent worker transactions", async () => {
    const fixture = await createGuestOrder();
    await setReviewDeadlineOffset(fixture.id, -1);
    const orders = app.get(OrdersService);
    const counts = await Promise.all([
      orders.expirePendingServiceabilityReviews(),
      orders.expirePendingServiceabilityReviews(),
      orders.expirePendingServiceabilityReviews(),
    ]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await orderById(fixture.id))?.status).toBe("cancelled");
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    const releaseCommands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(
      releaseCommands.filter((command) => command.operation === "release"),
    ).toHaveLength(1);
  });
});

function setCookieHeaders(headers: Record<string, unknown>): string[] {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}
