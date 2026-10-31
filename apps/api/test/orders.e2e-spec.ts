import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, vi } from "vitest";
import {
  API_V1_BASE_PATH,
  type BangladeshGeography,
  type CreateOrderInput,
  type OrderAddress,
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
  orderPathaoBookingClaim,
} from "../src/orders/orders-schema.js";
import { OrdersService } from "../src/orders/orders.service.js";
import {
  pathaoApiToken,
  pathaoBooking,
  pathaoWebhookInbox,
  pathaoWebhookResolution,
} from "../src/delivery/pathao/pathao-schema.js";
import { PathaoService } from "../src/delivery/pathao/pathao.service.js";
import { PathaoTokenService } from "../src/delivery/pathao/pathao-token.service.js";
import { quoteSnapshot } from "../src/quote/quote-schema.js";

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

function encryptOrderAddressForTest(
  address: OrderAddress,
  orderId: string,
): string {
  const configuration = process.env.ORDER_PII_KEYRING?.trim();
  const keyring = configuration
    ? (JSON.parse(configuration) as {
        activeKeyId: string;
        keys: Record<string, string>;
      })
    : null;
  const keyId = keyring?.activeKeyId ?? "legacy";
  const encodedKey =
    keyring?.keys[keyId] ?? process.env.ORDER_PII_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("The Order PII test key is not configured.");
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(encodedKey, "base64url"),
    nonce,
  );
  cipher.setAAD(Buffer.from(`aaraj/order-address/v2:${keyId}:${orderId}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(address), "utf8"),
    cipher.final(),
  ]);

  return [
    "v2",
    keyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

describe("COD Orders and checkout", () => {
  let app: NestExpressApplication;
  let database: DatabaseService;
  let staff: Account;
  let secondStaff: Account;
  let customer: Account;
  let geography: BangladeshGeography;
  let dhaka: BangladeshGeography["locations"][number];
  let dhakaDivision: BangladeshGeography["locations"][number];
  const pathaoEnvironmentKeys = [
    "PATHAO_BASE_URL",
    "PATHAO_SANDBOX_CLIENT_ID",
    "PATHAO_SANDBOX_CLIENT_SECRET",
    "PATHAO_SANDBOX_USERNAME",
    "PATHAO_SANDBOX_PASSWORD",
    "PATHAO_SANDBOX_WEBHOOK_SECRET",
  ];
  const previousPathaoEnvironment = new Map<string, string | undefined>();
  const orderPiiEnvironmentKeys = [
    "ORDER_PII_ENCRYPTION_KEY",
    "ORDER_PII_KEYRING",
  ];
  const previousOrderPiiEnvironment = new Map(
    orderPiiEnvironmentKeys.map((key) => [key, process.env[key]]),
  );

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

  function dispatchOrder(
    orderId: string,
    cookie: string,
    commandId = randomUUID(),
    input: {
      deliveryProvider?: "manual" | "pathao";
      deliveryOperator: string;
      handoffReference?: string;
    } = {
      deliveryProvider: "manual",
      deliveryOperator: "AARAJ Dispatch Desk",
      handoffReference: "HANDOFF-TEST-01",
    },
  ) {
    return request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/manage/${orderId}/dispatch`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("Idempotency-Key", commandId)
      .send(input);
  }

  async function confirmServiceable(orderId: string) {
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/manage/${orderId}/serviceability`)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({ outcome: "serviceable", reason: "Destination is serviceable" })
      .expect(201);
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

  async function createGuestOrder(
    stock = 2,
    addressExtra: Partial<CreateOrderInput["address"]> = {},
  ) {
    const variantId = await createVariant(stock);
    const cart = await newGuestCart([variantId]);
    const quote = await createQuote(cart.cookie);
    const key = randomUUID();
    const checkoutCookie = await prepareGuestCheckout(cart.cookie, key);
    const response = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id, addressExtra),
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

  function mockPathaoApi(
    options: {
      orderReference?: string;
      consignmentId?: string;
      createOrderFails?: boolean;
      createOrderStarted?: () => void;
      waitBeforeCreateOrderResponse?: Promise<void>;
      rejectRefresh?: boolean;
      rejectPassword?: boolean;
      rejectPasswordAfterFirst?: boolean;
    } = {},
  ) {
    const requests: Array<{
      url: string;
      method: string;
      body: Record<string, unknown> | null;
    }> = [];
    const state = {
      infoStatus: "pending",
      infoUnavailable: false,
      tokenGrants: [] as string[],
    };
    let tokenNumber = 0;
    let createdOrderNumber = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request ? input.url : input.toString();
        const url = new URL(requestUrl);
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url: url.toString(), method, body });

        if (url.pathname.endsWith("/issue-token")) {
          const grant =
            typeof body?.grant_type === "string" ? body.grant_type : "";
          state.tokenGrants.push(grant);
          if (
            (grant === "refresh_token" && options.rejectRefresh) ||
            (grant === "password" &&
              (options.rejectPassword ||
                (options.rejectPasswordAfterFirst &&
                  state.tokenGrants.filter((item) => item === "password")
                    .length > 1)))
          ) {
            return new Response(JSON.stringify({ message: "invalid_grant" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          tokenNumber += 1;
          return new Response(
            JSON.stringify({
              token_type: "Bearer",
              expires_in: 432000,
              access_token: `test-access-${tokenNumber}`,
              refresh_token: `test-refresh-${tokenNumber}`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname.endsWith("/stores")) {
          return new Response(
            JSON.stringify({
              data: {
                data: [
                  {
                    store_id: 101,
                    store_name: "Active Test Store",
                    is_active: 1,
                    is_default_store: 1,
                  },
                  {
                    store_id: 202,
                    store_name: "Inactive Test Store",
                    is_active: 0,
                    is_default_store: 0,
                  },
                ],
                last_page: 1,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.pathname.endsWith("/orders") && method === "POST") {
          if (options.createOrderFails) throw new TypeError("injected timeout");
          options.createOrderStarted?.();
          await options.waitBeforeCreateOrderResponse;
          return new Response(
            JSON.stringify({
              data: {
                consignment_id:
                  options.consignmentId ??
                  `PATHAO-TEST-${String(++createdOrderNumber).padStart(4, "0")}`,
                merchant_order_id: body?.merchant_order_id,
                order_status: "Pending",
                delivery_fee: 83.46,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (
          url.pathname.includes("/orders/") &&
          url.pathname.endsWith("/info")
        ) {
          if (state.infoUnavailable) {
            return new Response(
              JSON.stringify({ message: "temporary failure" }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const consignmentId = decodeURIComponent(
            url.pathname.split("/").at(-2) ?? "",
          );
          return new Response(
            JSON.stringify({
              data: {
                consignment_id: consignmentId,
                merchant_order_id: options.orderReference ?? null,
                order_status_slug: state.infoStatus,
                updated_at: "2026-10-10T00:00:00Z",
                invoice_id: null,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return { requests, state, fetchMock };
  }

  async function setOrderAge(orderId: string, ageHours: number) {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`ALTER TABLE orders.order_header DISABLE TRIGGER order_header_protect_update`,
      );
      try {
        await transaction.execute(sql`
          WITH fixture_time AS (
            SELECT clock_timestamp() - ${ageHours} * interval '1 hour' AS created_at
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

  async function createLegacyTimeoutCancellation(fixture: {
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
            SELECT clock_timestamp() - interval '1 hour' AS created_at
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
          reason: "Legacy automatic cancellation record.",
          metadata: {
            cancellationReason: "serviceability_review_timeout",
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
    for (const key of pathaoEnvironmentKeys) {
      previousPathaoEnvironment.set(key, process.env[key]);
    }
    Object.assign(process.env, {
      PATHAO_BASE_URL: "https://courier-api-sandbox.pathao.com",
      PATHAO_SANDBOX_CLIENT_ID: "pathao-test-client",
      PATHAO_SANDBOX_CLIENT_SECRET: "pathao-test-secret",
      PATHAO_SANDBOX_USERNAME: "pathao-test@example.invalid",
      PATHAO_SANDBOX_PASSWORD: "test-only-password",
      PATHAO_SANDBOX_WEBHOOK_SECRET: "pathao-test-webhook-secret",
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: ["error"],
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    const bootstrap = await account("order-superadmin");
    staff = await account("order-staff");
    secondStaff = await account("order-staff-second");
    customer = await account("order-customer");
    const access = app.get(AccessService);
    await access.bootstrapSuperadmin(bootstrap.id, {
      reason: "Order E2E bootstrap",
    });
    await access.changeRole(bootstrap, staff.id, "staff", "grant", {
      reason: "COD serviceability review E2E operator",
    });
    await access.changeRole(bootstrap, secondStaff.id, "staff", "grant", {
      reason: "COD dispatch concurrency E2E operator",
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
    vi.unstubAllGlobals();
    await database.db.delete(pathaoApiToken);
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
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of previousPathaoEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of previousOrderPiiEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("places guest COD orders with a private 30-day order-scoped cookie and atomic held stock", async () => {
    const legacyKey =
      process.env.ORDER_PII_ENCRYPTION_KEY ??
      (
        JSON.parse(process.env.ORDER_PII_KEYRING ?? "{}") as {
          keys?: Record<string, string>;
        }
      ).keys?.legacy;
    expect(legacyKey).toBeTruthy();
    delete process.env.ORDER_PII_ENCRYPTION_KEY;
    const orderPiiKeys = {
      legacy: legacyKey!,
      rotation_a: randomBytes(32).toString("base64url"),
      rotation_b: randomBytes(32).toString("base64url"),
    };
    process.env.ORDER_PII_KEYRING = JSON.stringify({
      activeKeyId: "rotation_a",
      keys: orderPiiKeys,
    });

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
      reference: expect.stringMatching(/^ORD-[0-9]{3}-[0-9]{5}$/),
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
    expect(stored?.addressCiphertext).toMatch(/^v2\.rotation_a\./);
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

    process.env.ORDER_PII_KEYRING = JSON.stringify({
      activeKeyId: "rotation_b",
      keys: orderPiiKeys,
    });
    const rotatedPrivateOrder = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${response.body.id}`)
      .set("Cookie", guestCookie)
      .expect(200);
    expect(rotatedPrivateOrder.body.address).toMatchObject({
      recipientName: "E2E Recipient",
      phone: "+8801712345678",
    });
    const rotatedReplay = await placeOrder(
      checkoutCookie,
      checkoutBody(quote.id),
      key,
    ).expect(201);
    expect(rotatedReplay.body).toMatchObject({
      id: response.body.id,
      replayed: true,
    });

    const rotatedVariantId = await createVariant(1);
    const rotatedCart = await newGuestCart([rotatedVariantId]);
    const rotatedQuote = await createQuote(rotatedCart.cookie);
    const rotatedKey = randomUUID();
    const rotatedCheckoutCookie = await prepareGuestCheckout(
      rotatedCart.cookie,
      rotatedKey,
    );
    const rotatedOrder = await placeOrder(
      rotatedCheckoutCookie,
      checkoutBody(rotatedQuote.id),
      rotatedKey,
    ).expect(201);
    expect((await orderById(rotatedOrder.body.id))?.addressCiphertext).toMatch(
      /^v2\.rotation_b\./,
    );

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
      checkoutBody(quote.id, {
        doorstepDetails: "House 14, Road 6, near the lake",
      }),
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
    const expiredCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    const [pastQuote] = await database.db
      .insert(quoteSnapshot)
      .values({
        ...expiredSnapshot,
        createdAt: expiredCreatedAt,
        expiresAt: new Date(expiredCreatedAt.getTime() + 15 * 60 * 1000),
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
      .expect(401);
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

  it("paginates managed Orders with reference search and stable ordering", async () => {
    const fixture = await createGuestOrder();
    const sourceOrder = await orderById(fixture.id);
    if (!sourceOrder) throw new Error("Order pagination fixture is missing.");
    const sourceAddressResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    const sourceAddress = sourceAddressResponse.body.address as OrderAddress;
    const [sourceQuote] = await database.db
      .select()
      .from(quoteSnapshot)
      .where(eq(quoteSnapshot.id, sourceOrder.quoteId));
    if (!sourceQuote) throw new Error("Order quote fixture is missing.");

    const idPrefix = randomUUID().slice(0, 23);
    const referencePrefix = randomBytes(4).toString("hex").toUpperCase();
    const synthetic = Array.from({ length: 56 }, (_, index) => ({
      id: `${idPrefix}-${(index + 1).toString(16).padStart(12, "0")}`,
      quoteId: randomUUID(),
      reservationId: randomUUID(),
      reference: `AA-${referencePrefix}${(index + 1)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}`,
    }));

    try {
      await database.db
        .insert(quoteSnapshot)
        .values(
          synthetic.map(({ quoteId }) => ({ ...sourceQuote, id: quoteId })),
        );
      await database.db.insert(inventoryStockReservation).values(
        synthetic.map(({ reservationId }) => ({
          id: reservationId,
          status: "held" as const,
        })),
      );
      await database.db.insert(customerOrder).values(
        synthetic.map(({ id, quoteId, reservationId, reference }) => ({
          ...sourceOrder,
          id,
          quoteId,
          reservationId,
          reference,
          addressCiphertext: encryptOrderAddressForTest(sourceAddress, id),
        })),
      );

      const search = `AA-${referencePrefix}`;
      const expectedIds = synthetic
        .map(({ id }) => id)
        .sort()
        .reverse();
      const firstPage = await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/orders/manage`)
        .set("Cookie", staff.cookie)
        .query({ limit: 50, offset: 0, search })
        .expect(200);
      expect(firstPage.body).toMatchObject({
        limit: 50,
        offset: 0,
        hasMore: true,
        nextOffset: 50,
      });
      expect(firstPage.body.rows.map((row: { id: string }) => row.id)).toEqual(
        expectedIds.slice(0, 50),
      );
      expect(firstPage.body.rows[0]).toMatchObject({
        deliveryProvider: sourceOrder.deliveryProvider,
        codAmountDueBdt: sourceOrder.codAmountDueBdt,
      });

      const secondPage = await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/orders/manage`)
        .set("Cookie", staff.cookie)
        .query({ limit: 50, offset: 50, search })
        .expect(200);
      expect(secondPage.body).toMatchObject({
        limit: 50,
        offset: 50,
        hasMore: false,
        nextOffset: null,
      });
      expect(secondPage.body.rows.map((row: { id: string }) => row.id)).toEqual(
        expectedIds.slice(50),
      );

      const repeatedFirstPage = await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/orders/manage`)
        .set("Cookie", staff.cookie)
        .query({ limit: 50, offset: 0, search })
        .expect(200);
      expect(
        repeatedFirstPage.body.rows.map((row: { id: string }) => row.id),
      ).toEqual(expectedIds.slice(0, 50));

      await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/orders/manage`)
        .set("Cookie", staff.cookie)
        .query({ search: "AA-DEADBEEF" })
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({ hasMore: false, nextOffset: null });
          expect(body.rows).toHaveLength(0);
        });
    } finally {
      await database.db.delete(customerOrder).where(
        inArray(
          customerOrder.id,
          synthetic.map(({ id }) => id),
        ),
      );
      await database.db.delete(inventoryStockReservation).where(
        inArray(
          inventoryStockReservation.id,
          synthetic.map(({ reservationId }) => reservationId),
        ),
      );
    }
  });

  it("filters managed Orders by fulfillment status", async () => {
    const awaitingDispatch = await createGuestOrder();
    const awaitingReview = await createGuestOrder();
    await confirmServiceable(awaitingDispatch.id);

    const response = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/manage`)
      .set("Cookie", staff.cookie)
      .query({ fulfillmentStatus: "awaiting_dispatch" })
      .expect(200);

    expect(response.body.rows.map((row: { id: string }) => row.id)).toContain(
      awaitingDispatch.id,
    );
    expect(
      response.body.rows.map((row: { id: string }) => row.id),
    ).not.toContain(awaitingReview.id);
  });

  it("cancels a confirmed undispatched Order and releases its reservation atomically", async () => {
    const fixture = await createGuestOrder();
    await confirmServiceable(fixture.id);

    const response = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/manage/${fixture.id}/cancel`)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({ reason: "Customer confirmed cancellation by phone" })
      .expect(201);

    expect(response.body).toMatchObject({
      status: "cancelled",
      fulfillmentStatus: "cancelled",
      cancellationReason: "staff_cancelled",
    });
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    const [reservation] = await database.db
      .select({ status: inventoryStockReservation.status })
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, fixture.reservationId));
    expect(reservation?.status).toBe("released");
    const [cancellationAudit] = await database.db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.subjectId, fixture.id),
          eq(
            auditEvent.eventType,
            "commerce.cod_order_cancelled_before_dispatch",
          ),
        ),
      );
    expect(cancellationAudit).toBeDefined();
  });

  it("records delivery outcomes and COD collection through guarded transitions", async () => {
    const fixture = await createGuestOrder();
    await confirmServiceable(fixture.id);
    await dispatchOrder(fixture.id, staff.cookie).expect(201);

    const delivery = await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/orders/manage/${fixture.id}/fulfillment-outcome`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({ outcome: "delivered", reason: "Delivery receipt verified" })
      .expect(201);
    expect(delivery.body.fulfillmentStatus).toBe("delivered");
    expect(delivery.body.collectionStatus).toBe("uncollected");

    const stored = await orderById(fixture.id);
    if (!stored) throw new Error("Delivered Order fixture is missing.");
    const discrepancy = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/manage/${fixture.id}/collection`)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({
        collectedAmountBdt: stored.codAmountDueBdt - 1,
        reason: "Courier receipt differs by BDT 1",
      })
      .expect(201);
    expect(discrepancy.body).toMatchObject({
      collectionStatus: "discrepancy",
      collectedAmountBdt: stored.codAmountDueBdt - 1,
    });

    const reconciled = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/orders/manage/${fixture.id}/collection`)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .send({
        collectedAmountBdt: stored.codAmountDueBdt,
        reason: "Corrected against signed delivery receipt",
      })
      .expect(201);
    expect(reconciled.body).toMatchObject({
      collectionStatus: "collected",
      collectedAmountBdt: stored.codAmountDueBdt,
    });
  });

  it("rejects invalid managed Order list query parameters", async () => {
    for (const query of [
      { limit: 0 },
      { offset: 100_001 },
      { search: "not a reference" },
      { fulfillmentStatus: "unknown" },
    ]) {
      await request(app.getHttpServer())
        .get(`${API_V1_BASE_PATH}/orders/manage`)
        .set("Cookie", staff.cookie)
        .query(query)
        .expect(400);
    }
  });

  it("dispatches a confirmed COD Order and consumes its held reservation exactly once", async () => {
    const fixture = await createGuestOrder(2);
    const before = await stockFor(fixture.variantId);
    expect(before.quantityOnHand - before.quantityReserved).toBe(1);
    const original = await orderById(fixture.id);

    await dispatchOrder(fixture.id, staff.cookie).expect(409);
    await dispatchOrder(fixture.id, customer.cookie).expect(403);
    await confirmServiceable(fixture.id);

    const commandId = randomUUID();
    const input = {
      deliveryOperator: "AARAJ Dispatch Desk",
      handoffReference: "HANDOFF-TEST-01",
    };
    const dispatched = await dispatchOrder(
      fixture.id,
      staff.cookie,
      commandId,
      input,
    ).expect(201);
    expect(dispatched.body).toMatchObject({
      id: fixture.id,
      status: "confirmed",
      serviceability: "serviceable",
      fulfillmentStatus: "dispatched",
      paymentMethod: "cod",
      collectionStatus: "uncollected",
      codAmountDueBdt: original?.codAmountDueBdt,
      dispatch: {
        deliveryOperator: input.deliveryOperator,
        handoffReference: input.handoffReference,
        dispatchedAt: expect.any(String),
      },
    });
    expect(
      Date.parse(dispatched.body.dispatch.dispatchedAt),
    ).toBeLessThanOrEqual(Date.now());

    const after = await stockFor(fixture.variantId);
    expect(after.quantityOnHand).toBe(before.quantityOnHand - 1);
    expect(after.quantityReserved).toBe(before.quantityReserved - 1);
    expect(after.quantityOnHand - after.quantityReserved).toBe(
      before.quantityOnHand - before.quantityReserved,
    );
    const [reservation] = await database.db
      .select()
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, fixture.reservationId));
    expect(reservation?.status).toBe("consumed");
    const commands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(commands.filter(({ operation }) => operation === "consume")).toEqual(
      [expect.objectContaining({ commandId, operation: "consume" })],
    );

    const visible = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(visible.body).toMatchObject({
      fulfillmentStatus: "dispatched",
      collectionStatus: "uncollected",
      codAmountDueBdt: original?.codAmountDueBdt,
      dispatch: {
        deliveryOperator: input.deliveryOperator,
        handoffReference: input.handoffReference,
      },
    });

    await dispatchOrder(fixture.id, secondStaff.cookie, commandId, input)
      .expect(201)
      .expect(({ body }) =>
        expect(body.dispatch).toEqual(dispatched.body.dispatch),
      );
    await dispatchOrder(fixture.id, staff.cookie, commandId, {
      ...input,
      handoffReference: "CHANGED-REFERENCE",
    }).expect(409);
    await dispatchOrder(fixture.id, staff.cookie, commandId, {
      ...input,
      deliveryProvider: "pathao",
    }).expect(409);
    await dispatchOrder(fixture.id, staff.cookie, randomUUID(), input).expect(
      409,
    );
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(
      before.quantityOnHand - 1,
    );
    const afterOrder = await orderById(fixture.id);
    expect(afterOrder).toMatchObject({
      addressCiphertext: original?.addressCiphertext,
      guestAccessTokenHash: original?.guestAccessTokenHash,
      guestAccessExpiresAt: original?.guestAccessExpiresAt,
      merchandiseGrossBdt: original?.merchandiseGrossBdt,
      deliveryAmountBdt: original?.deliveryAmountBdt,
      totalBdt: original?.totalBdt,
      codAmountDueBdt: original?.codAmountDueBdt,
      deliverySnapshot: original?.deliverySnapshot,
    });
    const transitions = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, fixture.id));
    const dispatchEvents = transitions.filter(
      ({ eventType }) => eventType === "commerce.cod_order_dispatched",
    );
    expect(dispatchEvents).toHaveLength(1);
    expect(dispatchEvents[0]).toMatchObject({
      actorType: "user",
      actorId: staff.id,
      metadata: { commandId, reservationId: fixture.reservationId },
    });
  });

  it("serializes two staff dispatches to one inventory consumption", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const input = {
      deliveryOperator: "AARAJ Dispatch Desk",
      handoffReference: "RACE-TEST-01",
    };
    const [first, second] = await Promise.all([
      dispatchOrder(fixture.id, staff.cookie, randomUUID(), input),
      dispatchOrder(fixture.id, secondStaff.cookie, randomUUID(), input),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(await stockFor(fixture.variantId)).toEqual({
      variantId: fixture.variantId,
      quantityOnHand: 1,
      quantityReserved: 0,
      updatedAt: expect.any(Date),
    });
    const [stored] = await database.db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.id, fixture.id));
    expect(stored?.fulfillmentStatus).toBe("dispatched");
  });

  it("rolls back Inventory consumption and Order state when the dispatch audit cannot be written", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const audit = app.get(AuditService);
    const appendAudit = audit.append.bind(audit);
    const append = vi
      .spyOn(audit, "append")
      .mockImplementation(async (transaction, event) => {
        if (event.eventType === "commerce.cod_order_dispatched") {
          throw new Error("Injected dispatch audit failure.");
        }
        return appendAudit(transaction, event);
      });
    const before = await stockFor(fixture.variantId);
    try {
      await dispatchOrder(fixture.id, staff.cookie).expect(500);
    } finally {
      append.mockRestore();
    }
    const order = await orderById(fixture.id);
    expect(order?.fulfillmentStatus).toBe("awaiting_dispatch");
    expect(order?.dispatchCommandId).toBeNull();
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: before.quantityOnHand,
      quantityReserved: before.quantityReserved,
    });
    const [reservation] = await database.db
      .select()
      .from(inventoryStockReservation)
      .where(eq(inventoryStockReservation.id, fixture.reservationId));
    expect(reservation?.status).toBe("held");
    const commands = await database.db
      .select()
      .from(inventoryReservationCommand)
      .where(
        eq(inventoryReservationCommand.reservationId, fixture.reservationId),
      );
    expect(
      commands.filter(({ operation }) => operation === "consume"),
    ).toHaveLength(0);
  });

  it("lets the database reject dispatch without the matching consumed reservation", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const before = await stockFor(fixture.variantId);
    let transitionError: unknown;
    try {
      await database.db
        .update(customerOrder)
        .set({
          fulfillmentStatus: "dispatched",
          deliveryProvider: "manual",
          dispatchCommandId: randomUUID(),
          dispatchRequestFingerprint: "a".repeat(64),
          deliveryOperator: "AARAJ Dispatch Desk",
          dispatchedBy: staff.id,
          dispatchedAt: sql`clock_timestamp()`,
        })
        .where(eq(customerOrder.id, fixture.id));
    } catch (error) {
      transitionError = error;
    }
    expect(transitionError).toMatchObject({
      cause: {
        message: expect.stringContaining(
          "The Order reservation must be consumed before dispatch",
        ),
      },
    });
    expect((await orderById(fixture.id))?.fulfillmentStatus).toBe(
      "awaiting_dispatch",
    );
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: before.quantityOnHand,
      quantityReserved: before.quantityReserved,
    });
  });

  it("authenticates Pathao webhook handshakes and bounds webhook bodies", async () => {
    const webhookPath = `${API_V1_BASE_PATH}/delivery/pathao/webhook`;
    const verifySignature = vi.spyOn(
      app.get(PathaoService),
      "verifyWebhookSignature",
    );
    const valid = await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "application/json")
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({ event: "webhook_integration" });
    expect(valid.status, JSON.stringify(valid.body)).toBe(202);
    expect(verifySignature).toHaveBeenCalledWith("pathao-test-webhook-secret");
    expect(valid.headers["x-pathao-merchant-webhook-integration-secret"]).toBe(
      "f3992ecc-59da-4cbe-a049-a13da2018d51",
    );
    expect(valid.body).toEqual({ handshake: true, duplicate: false });

    await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "application/json")
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("X-PATHAO-Signature", "wrong-secret")
      .send({ event: "webhook_integration" })
      .expect(401);

    await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "text/plain")
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send('{"event":"webhook_integration"}')
      .expect(400);

    await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "application/json")
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .send('{"event":')
      .expect(400);

    await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({ event: "", store_id: "not-an-integer" })
      .expect(422);

    await request(app.getHttpServer())
      .post(webhookPath)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({ event: "order.updated", filler: "x".repeat(34_000) })
      .expect(413);

    await request(app.getHttpServer())
      .put(webhookPath)
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ event: "webhook_integration" })
      .expect(403);

    await request(app.getHttpServer())
      .post(`${webhookPath}/unexpected`)
      .set("Origin", "https://courier.pathao.example")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ event: "webhook_integration" })
      .expect(403);
  });

  it("blocks dispatch during Pathao booking, attaches an early webhook, and allows the confirmed Pathao handoff", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Pathao race Order fixture is missing.");
    let startCreate!: () => void;
    let releaseCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      startCreate = resolve;
    });
    const createResponseGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const consignmentId = "PATHAO-EARLY-WEBHOOK-01";
    const provider = mockPathaoApi({
      orderReference: order.reference,
      consignmentId,
      createOrderStarted: startCreate,
      waitBeforeCreateOrderResponse: createResponseGate,
    });
    const bookingRequest = request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .then((response) => response);

    await createStarted;
    const assignment = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(assignment.body.claimStatus).toBe("submitting");
    await dispatchOrder(fixture.id, staff.cookie).expect(409);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.created",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T00:30:00Z",
        store_id: 101,
      })
      .expect(202);
    const [earlyEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    expect(earlyEvent).toMatchObject({
      bookingId: null,
      processingState: "unmatched",
    });

    releaseCreate();
    const booked = await bookingRequest;
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ status: "booked", consignmentId });
    const [attachedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    expect(attachedEvent).toMatchObject({
      bookingId: expect.any(String),
      processingState: "pending",
      lastErrorCode: null,
    });
    await app.get(PathaoService).processPendingWebhooks();
    const [verifiedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    expect(verifiedEvent?.processingState).toBe("verified");

    const dispatched = await dispatchOrder(
      fixture.id,
      staff.cookie,
      randomUUID(),
      {
        deliveryProvider: "pathao",
        deliveryOperator: "AARAJ Dispatch Desk",
        handoffReference: "PATHAO-HANDOFF-01",
      },
    ).expect(201);
    expect(dispatched.body.dispatch.deliveryProvider).toBe("pathao");
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
    expect(
      provider.requests.filter(
        ({ url, method }) =>
          url.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("rejects Pathao booking after a manual dispatch has consumed the reservation", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const provider = mockPathaoApi();
    await dispatchOrder(fixture.id, staff.cookie).expect(201);
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .expect(409);
    expect(
      provider.requests.filter(
        ({ url, method }) =>
          url.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toHaveLength(0);
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
  });

  it("books with the active default store and derives package data from the Order", async () => {
    const fixture = await createGuestOrder(2, {
      instructions: "Call from the gate\nUse the east entrance",
    });
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Pathao booking Order fixture is missing.");
    const provider = mockPathaoApi({ orderReference: order.reference });

    const bookingUrl = `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`;
    const [firstBooking, competingBooking] = await Promise.all([
      request(app.getHttpServer())
        .post(bookingUrl)
        .set("Origin", origin)
        .set("Cookie", staff.cookie)
        .set("Idempotency-Key", randomUUID())
        .send(),
      request(app.getHttpServer())
        .post(bookingUrl)
        .set("Origin", origin)
        .set("Cookie", secondStaff.cookie)
        .set("Idempotency-Key", randomUUID())
        .send(),
    ]);
    expect(
      [firstBooking.status, competingBooking.status].sort(
        (left, right) => left - right,
      ),
    ).toEqual([201, 409]);
    const booking =
      firstBooking.status === 201 ? firstBooking : competingBooking;
    expect(booking.body).toMatchObject({
      orderId: fixture.id,
      source: "api",
      status: "booked",
      consignmentId: "PATHAO-TEST-0001",
      deliveryFeeBdt: 83.46,
    });
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityReserved: 1,
      quantityOnHand: 2,
    });
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(2);

    const createRequests = provider.requests.filter(
      ({ url, method }) =>
        url.endsWith("/aladdin/api/v1/orders") && method === "POST",
    );
    expect(createRequests).toHaveLength(1);
    const createRequest = createRequests[0];
    expect(createRequest?.body).toMatchObject({
      store_id: 101,
      merchant_order_id: order.reference,
      recipient_name: "E2E Recipient",
      recipient_phone: "01712345678",
      special_instruction: "Call from the gate Use the east entrance",
      delivery_type: 48,
      item_type: 2,
      item_quantity: 1,
      item_weight: 0.5,
      amount_to_collect: order.codAmountDueBdt,
    });
    expect(createRequest?.body).not.toHaveProperty("recipient_city");
    expect(createRequest?.body).not.toHaveProperty("recipient_zone");
    expect(createRequest?.body).not.toHaveProperty("recipient_area");
    expect(createRequest?.body).not.toHaveProperty("item_description");

    const longInstruction = "x".repeat(201);
    const longInstructionFixture = await createGuestOrder(2, {
      instructions: longInstruction,
    });
    await confirmServiceable(longInstructionFixture.id);
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${longInstructionFixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .expect(201);
    const longInstructionRequest = provider.requests.find(
      ({ url, method, body }) =>
        url.endsWith("/aladdin/api/v1/orders") &&
        method === "POST" &&
        body?.special_instruction === longInstruction,
    );
    expect(longInstructionRequest?.body?.special_instruction).toBe(
      longInstruction,
    );
    expect(
      provider.requests.filter(
        ({ url, method }) =>
          url.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toHaveLength(2);

    const duplicateWebhook = {
      event: "order.picked",
      consignment_id: "PATHAO-TEST-0001",
      merchant_order_id: order.reference,
      timestamp: "2026-10-10T01:00:00Z",
      updated_at: "2026-10-10 07:00:00",
      store_id: 101,
    };
    const [firstAcceptance, secondAcceptance] = await Promise.all([
      request(app.getHttpServer())
        .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
        .set("Content-Type", "application/json")
        .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
        .send(duplicateWebhook)
        .expect(202),
      request(app.getHttpServer())
        .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
        .set("Content-Type", "application/json")
        .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
        .send(duplicateWebhook)
        .expect(202),
    ]);
    expect(
      [firstAcceptance.body.duplicate, secondAcceptance.body.duplicate].sort(
        (left, right) => Number(left) - Number(right),
      ),
    ).toEqual([false, true]);
    const [persistedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-0001"));
    expect(persistedEvent?.processingState).toBe("pending");

    provider.state.infoStatus = "picked";
    await Promise.all([
      app.get(PathaoService).processPendingWebhooks(),
      app.get(PathaoService).processPendingWebhooks(),
    ]);
    const [preDispatchEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(
        and(
          eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-0001"),
          eq(pathaoWebhookInbox.eventName, "order.picked"),
        ),
      );
    expect(preDispatchEvent).toMatchObject({
      processingState: "reconciliation_required",
      lastErrorCode: "PATHAO_ACTIVITY_BEFORE_AARAJ_DISPATCH",
    });
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(2);

    const dispatch = await dispatchOrder(
      fixture.id,
      staff.cookie,
      randomUUID(),
      {
        deliveryProvider: "pathao",
        deliveryOperator: "AARAJ Dispatch Desk",
      },
    ).expect(201);
    expect(dispatch.body).toMatchObject({
      fulfillmentStatus: "dispatched",
      collectionStatus: "uncollected",
      codAmountDueBdt: order.codAmountDueBdt,
    });
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(1);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);

    provider.state.infoStatus = "in-transit";
    provider.state.infoUnavailable = true;
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.in-transit",
        consignment_id: "PATHAO-TEST-0001",
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T02:00:00Z",
        store_id: 101,
      })
      .expect(202);
    await app.get(PathaoService).processPendingWebhooks();
    const [retryingEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(
        and(
          eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-0001"),
          eq(pathaoWebhookInbox.eventName, "order.in-transit"),
        ),
      );
    expect(retryingEvent).toMatchObject({
      processingState: "retry",
      lastErrorCode: "PATHAO_HTTP_503",
    });
    provider.state.infoUnavailable = false;
    await database.db
      .update(pathaoWebhookInbox)
      .set({ nextAttemptAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(pathaoWebhookInbox.id, retryingEvent!.id));
    await app.get(PathaoService).processPendingWebhooks();

    provider.state.infoStatus = "in-transit";
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.picked",
        consignment_id: "PATHAO-TEST-0001",
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T02:30:00Z",
        store_id: 101,
      })
      .expect(202);
    await app.get(PathaoService).processPendingWebhooks();
    const [staleEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(
        and(
          eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-0001"),
          eq(pathaoWebhookInbox.eventName, "order.picked"),
        ),
      )
      .orderBy(desc(pathaoWebhookInbox.receivedAt))
      .limit(1);
    expect(staleEvent).toMatchObject({
      processingState: "reconciliation_required",
      lastErrorCode: "PATHAO_STATUS_REQUIRES_REVIEW",
    });

    provider.state.infoStatus = "returned-to-merchant";
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.returned-to-merchant",
        consignment_id: "PATHAO-TEST-0001",
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T03:00:00Z",
        store_id: 101,
      })
      .expect(202);
    await app.get(PathaoService).processPendingWebhooks();

    const customerTracking = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/orders/${fixture.id}/tracking`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(customerTracking.headers["cache-control"]).toContain("no-store");
    expect(customerTracking.body).toMatchObject({
      booking: {
        consignmentId: "PATHAO-TEST-0001",
        trackingProgress: "returned",
      },
      observations: expect.arrayContaining([
        expect.objectContaining({ event: "order.in-transit" }),
        expect.objectContaining({ event: "order.returned-to-merchant" }),
      ]),
    });
    expect(customerTracking.body).not.toHaveProperty("providerOrderStatus");
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/orders/${fixture.id}/tracking`)
      .set("Cookie", customer.cookie)
      .expect(404);
    const customerOrderResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(customerOrderResponse.body.collectionStatus).toBe("uncollected");
    expect(customerOrderResponse.body.codAmountDueBdt).toBe(
      order.codAmountDueBdt,
    );
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(1);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
  });

  it("keeps delivered and paid courier observations separate from COD collection and Inventory", async () => {
    const fixture = await createGuestOrder(1);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Pathao delivery Order fixture is missing.");
    const consignmentId = `PATHAO-DELIVERED-${randomUUID().slice(0, 8).toUpperCase()}`;
    const provider = mockPathaoApi({
      orderReference: order.reference,
      consignmentId,
    });

    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .expect(201);
    await dispatchOrder(fixture.id, staff.cookie, randomUUID(), {
      deliveryProvider: "pathao",
      deliveryOperator: "AARAJ Dispatch Desk",
    }).expect(201);

    provider.state.infoStatus = "delivered";
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.delivered",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T06:00:00Z",
        store_id: 101,
        collected_amount: order.codAmountDueBdt,
      })
      .expect(202);
    await app.get(PathaoService).processPendingWebhooks();

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.paid",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T06:01:00Z",
        store_id: 101,
        collected_amount: order.codAmountDueBdt,
      })
      .expect(202);
    await app.get(PathaoService).processPendingWebhooks();

    const customerOrderResponse = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/orders/${fixture.id}`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(customerOrderResponse.body).toMatchObject({
      status: "confirmed",
      fulfillmentStatus: "dispatched",
      collectionStatus: "uncollected",
      codAmountDueBdt: order.codAmountDueBdt,
      totalBdt: order.totalBdt,
    });
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(0);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    const staffBookingDetails = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(staffBookingDetails.body.observations).toContainEqual(
      expect.objectContaining({
        event: "order.delivered",
        providerCollectedAmount: order.codAmountDueBdt,
      }),
    );
    const customerTracking = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/orders/${fixture.id}/tracking`)
      .set("Cookie", fixture.cookie)
      .expect(200);
    expect(customerTracking.body.observations[0]).not.toHaveProperty(
      "providerCollectedAmount",
    );
    const providerObservations = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    expect(providerObservations).toHaveLength(2);
    expect(
      providerObservations.every(
        (observation) => observation.processingState === "verified",
      ),
    ).toBe(true);
    expect(
      providerObservations.find(
        (observation) => observation.eventName === "order.paid",
      )?.providerCollectedAmountBdt,
    ).toBe(order.codAmountDueBdt);
  });

  it("quarantines mismatched stores, consignment IDs, and unknown events without changing Order or stock", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Pathao mismatch Order fixture is missing.");
    const consignmentId = `PATHAO-MISMATCH-${randomUUID().slice(0, 8).toUpperCase()}`;
    const provider = mockPathaoApi({
      orderReference: order.reference,
      consignmentId,
    });

    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.in-transit",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T07:00:00Z",
        store_id: 202,
      })
      .expect(202);
    provider.state.infoStatus = "in-transit";
    await app.get(PathaoService).processPendingWebhooks();
    const [mismatchedStore] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    expect(mismatchedStore).toMatchObject({
      processingState: "reconciliation_required",
      lastErrorCode: "PATHAO_ORDER_IDENTITY_MISMATCH",
    });

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.in-transit",
        consignment_id: `${consignmentId}-WRONG`,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T07:01:00Z",
        store_id: 101,
      })
      .expect(202);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.unknown-delivery-outcome",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T07:02:00Z",
        store_id: 101,
      })
      .expect(202);

    const booking = await app
      .get(PathaoService)
      .getManagementBooking(fixture.id);
    expect(booking).toMatchObject({
      status: "booked",
      trackingProgress: "booked",
    });
    expect((await orderById(fixture.id))?.collectionStatus).toBe("uncollected");
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 2,
      quantityReserved: 1,
    });
    const issues = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/issues`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(issues.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: fixture.id,
          orderReference: order.reference,
          consignmentId,
          merchantOrderId: order.reference,
          storeId: 202,
          providerStatus: "in-transit",
          errorCode: "PATHAO_ORDER_IDENTITY_MISMATCH",
        }),
        expect.objectContaining({
          consignmentId: `${consignmentId}-WRONG`,
          status: "unmatched",
        }),
        expect.objectContaining({
          event: "order.unknown-delivery-outcome",
          status: "reconciliation_required",
        }),
      ]),
    );
    const summaries = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/orders`)
      .set("Cookie", staff.cookie)
      .query({ orderIds: fixture.id })
      .expect(200);
    expect(summaries.body).toContainEqual(
      expect.objectContaining({
        orderId: fixture.id,
        hasUnresolvedWebhookIssue: true,
      }),
    );

    const [issue] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    if (!issue) throw new Error("Linked Pathao issue fixture is missing.");
    const resolveUrl = `${API_V1_BASE_PATH}/delivery/pathao/manage/webhooks/${issue.id}/resolve`;
    const recheckCommandId = randomUUID();
    const recheckBody = {
      action: "recheck",
      reason: "Recheck the identity against Pathao after operator review",
    };
    await request(app.getHttpServer())
      .post(resolveUrl)
      .set("Origin", origin)
      .set("Cookie", customer.cookie)
      .set("Idempotency-Key", randomUUID())
      .send(recheckBody)
      .expect(403);
    const rechecked = await request(app.getHttpServer())
      .post(resolveUrl)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", recheckCommandId)
      .send(recheckBody)
      .expect(201);
    expect(rechecked.body).toEqual({
      eventId: issue.id,
      action: "recheck",
      status: "pending",
    });
    await request(app.getHttpServer())
      .post(resolveUrl)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", recheckCommandId)
      .send(recheckBody)
      .expect(201);
    await request(app.getHttpServer())
      .post(resolveUrl)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", recheckCommandId)
      .send({ ...recheckBody, reason: "Different reason for same command" })
      .expect(409);
    expect(
      await database.db
        .select()
        .from(pathaoWebhookResolution)
        .where(eq(pathaoWebhookResolution.commandId, recheckCommandId)),
    ).toHaveLength(1);

    await app.get(PathaoService).processPendingWebhooks();
    const [recheckedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.id, issue.id));
    expect(recheckedEvent?.processingState).toBe("reconciliation_required");
    const acknowledgeCommandId = randomUUID();
    const acknowledgeBody = {
      action: "acknowledge_no_change",
      reason: "Merchant panel confirms no tracking change is appropriate",
      verifiedInPathaoPanel: true,
    };
    const acknowledged = await request(app.getHttpServer())
      .post(resolveUrl)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", acknowledgeCommandId)
      .send(acknowledgeBody)
      .expect(201);
    expect(acknowledged.body).toEqual({
      eventId: issue.id,
      action: "acknowledge_no_change",
      status: "ignored",
    });
    const [terminalEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.id, issue.id));
    expect(terminalEvent?.processingState).toBe("ignored");
    const resolutionAudits = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, fixture.id));
    expect(
      resolutionAudits.filter(
        (event) => event.eventType === "commerce.pathao_webhook_issue_resolved",
      ),
    ).toHaveLength(2);
    expect((await orderById(fixture.id))?.collectionStatus).toBe("uncollected");
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 2,
      quantityReserved: 1,
    });
  });

  it("does not blindly retry an ambiguous create and supports guarded staff reconciliation", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order)
      throw new Error("Pathao reconciliation Order fixture is missing.");
    const provider = mockPathaoApi({
      orderReference: order.reference,
      createOrderFails: true,
    });
    const commandId = randomUUID();
    const url = `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`;
    const uncertain = await request(app.getHttpServer())
      .post(url)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", commandId)
      .send()
      .expect(201);
    expect(uncertain.body).toMatchObject({
      status: "outcome_unknown",
      lastErrorCode: "PATHAO_NETWORK_UNAVAILABLE",
    });
    const claim = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(claim.body.claimStatus).toBe("outcome_unknown");
    const replay = await request(app.getHttpServer())
      .post(url)
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", commandId)
      .send()
      .expect(201);
    expect(replay.body.status).toBe("outcome_unknown");
    expect(
      provider.requests.filter(
        ({ url: requestUrl, method }) =>
          requestUrl.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toHaveLength(1);
    await dispatchOrder(fixture.id, staff.cookie).expect(409);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);

    const reconciled = await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/reconcile`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({
        consignmentId: "PATHAO-TEST-AMBIG-01",
        reason: "Verified the consignment against the Pathao Merchant Panel",
        verifiedInPathaoPanel: true,
      })
      .expect(201);
    expect(reconciled.body).toMatchObject({
      status: "booked",
      deliveryType: 48,
      consignmentId: "PATHAO-TEST-AMBIG-01",
      reconciliationReason:
        "Verified the consignment against the Pathao Merchant Panel",
      reconciledAt: expect.any(String),
    });
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
    const dispatched = await dispatchOrder(
      fixture.id,
      staff.cookie,
      randomUUID(),
      {
        deliveryProvider: "pathao",
        deliveryOperator: "AARAJ Dispatch Desk",
      },
    ).expect(201);
    expect(dispatched.body.dispatch.deliveryProvider).toBe("pathao");
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
    const auditEvents = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, fixture.id));
    expect(
      auditEvents.filter(
        (event) =>
          event.eventType === "commerce.pathao_booking_manually_reconciled",
      ),
    ).toHaveLength(1);
  });

  it("reconciles a verified manually created consignment without matching webhook references automatically", async () => {
    const fixture = await createGuestOrder(1);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Manual Pathao Order fixture is missing.");
    const provider = mockPathaoApi({ orderReference: order.reference });
    const webhook = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.created",
        consignment_id: "PATHAO-TEST-MANUAL-01",
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T04:00:00Z",
        store_id: 101,
      })
      .expect(202);
    expect(webhook.body).toMatchObject({
      handshake: false,
      duplicate: false,
    });
    const issues = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/issues`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(issues.body.issues).toContainEqual(
      expect.objectContaining({
        orderId: null,
        consignmentId: "PATHAO-TEST-MANUAL-01",
        status: "unmatched",
      }),
    );

    provider.state.infoUnavailable = true;
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/reconcile`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send({
        consignmentId: "PATHAO-TEST-MANUAL-01",
        reason: "Checking the manual consignment in the Pathao Merchant Panel",
        verifiedInPathaoPanel: true,
      })
      .expect(503);
    const unresolvedClaim = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(unresolvedClaim.body).toMatchObject({
      booking: null,
      claimStatus: "reconciliation_required",
    });
    await dispatchOrder(fixture.id, staff.cookie).expect(409);
    provider.state.infoUnavailable = false;

    const reconciliationCommandId = randomUUID();
    const reconciliationBody = {
      consignmentId: "PATHAO-TEST-MANUAL-01",
      reason: "Verified the manual consignment in the Pathao Merchant Panel",
      verifiedInPathaoPanel: true,
    };
    const result = await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/reconcile`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", reconciliationCommandId)
      .send(reconciliationBody)
      .expect(201);
    expect(result.body).toMatchObject({
      source: "manual",
      status: "booked",
      deliveryType: null,
    });
    const [stored] = await database.db
      .select()
      .from(pathaoBooking)
      .where(eq(pathaoBooking.orderId, fixture.id));
    const [attachedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-MANUAL-01"));
    expect(stored?.id).toBe(attachedEvent?.bookingId);
    expect(attachedEvent?.processingState).toBe("pending");
    await app.get(PathaoService).processPendingWebhooks();
    const [verifiedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, "PATHAO-TEST-MANUAL-01"));
    expect(verifiedEvent?.processingState).toBe("verified");
    await database.db
      .update(pathaoWebhookInbox)
      .set({
        bookingId: null,
        processingState: "unmatched",
        processedAt: null,
      })
      .where(eq(pathaoWebhookInbox.id, verifiedEvent!.id));
    await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/reconcile`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", reconciliationCommandId)
      .send(reconciliationBody)
      .expect(201);
    const [replayedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.id, verifiedEvent!.id));
    expect(replayedEvent).toMatchObject({
      bookingId: stored?.id,
      processingState: "pending",
    });
    await app.get(PathaoService).processPendingWebhooks();
    const [reverifiedEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.id, verifiedEvent!.id));
    expect(reverifiedEvent?.processingState).toBe("verified");
    expect(
      provider.requests.some(
        ({ url, method }) =>
          url.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toBe(false);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
  });

  it("recovers a crashed booking and expired webhook lease in a fresh API process", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const order = await orderById(fixture.id);
    if (!order) throw new Error("Pathao recovery Order fixture is missing.");

    const interruptedFixture = await createGuestOrder(1);
    const interruptedOrder = await orderById(interruptedFixture.id);
    if (!interruptedOrder)
      throw new Error("Interrupted Pathao booking Order fixture is missing.");
    const interruptedId = randomUUID();
    const interruptedCommandId = randomUUID();
    await database.db.insert(pathaoBooking).values({
      id: interruptedId,
      orderId: interruptedFixture.id,
      environment: "sandbox",
      storeId: 101,
      deliveryType: 48,
      parcelQuantity: 1,
      parcelWeightKg: 0.5,
      merchantOrderId: interruptedOrder.reference,
      commandId: interruptedCommandId,
      requestFingerprint: "a".repeat(64),
      status: "submitting",
      submittedAt: sql`clock_timestamp() - interval '1 minute'`,
      createdBy: staff.id,
    });

    const consignmentId = `PATHAO-RESTART-${randomUUID().slice(0, 8).toUpperCase()}`;
    const provider = mockPathaoApi({
      orderReference: order.reference,
      consignmentId,
      createOrderFails: false,
    });
    const booked = await request(app.getHttpServer())
      .post(
        `${API_V1_BASE_PATH}/delivery/pathao/manage/orders/${fixture.id}/book`,
      )
      .set("Origin", origin)
      .set("Cookie", staff.cookie)
      .set("Idempotency-Key", randomUUID())
      .send()
      .expect(201);
    expect(booked.body.consignmentId).toBe(consignmentId);
    await dispatchOrder(fixture.id, staff.cookie, randomUUID(), {
      deliveryProvider: "pathao",
      deliveryOperator: "AARAJ Dispatch Desk",
    }).expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/delivery/pathao/webhook`)
      .set("Content-Type", "application/json")
      .set("X-PATHAO-Signature", "pathao-test-webhook-secret")
      .send({
        event: "order.in-transit",
        consignment_id: consignmentId,
        merchant_order_id: order.reference,
        timestamp: "2026-10-10T05:00:00Z",
        store_id: 101,
      })
      .expect(202);
    const [inboxEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.consignmentId, consignmentId));
    if (!inboxEvent) throw new Error("Pathao webhook fixture was not saved.");
    await database.db
      .update(pathaoWebhookInbox)
      .set({
        processingState: "processing",
        processingLeaseOwner: randomUUID(),
        processingLeaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
      })
      .where(eq(pathaoWebhookInbox.id, inboxEvent.id));

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./pathao-recovery-process.mjs", import.meta.url),
        ),
        order.reference,
        "in-transit",
      ],
      { env: process.env, timeout: 20_000 },
    );
    expect(JSON.parse(stdout.trim())).toEqual({
      expiredBookings: 1,
      processedWebhooks: 1,
    });

    const [recoveredBooking] = await database.db
      .select()
      .from(pathaoBooking)
      .where(eq(pathaoBooking.id, interruptedId));
    expect(recoveredBooking).toMatchObject({
      status: "outcome_unknown",
      lastErrorCode: "PATHAO_BOOKING_PROCESS_INTERRUPTED",
    });
    await dispatchOrder(interruptedFixture.id, staff.cookie).expect(409);
    const [recoveredEvent] = await database.db
      .select()
      .from(pathaoWebhookInbox)
      .where(eq(pathaoWebhookInbox.id, inboxEvent.id));
    expect(recoveredEvent?.processingState).toBe("verified");
    expect(recoveredEvent?.attemptCount).toBe(1);
    expect((await stockFor(fixture.variantId)).quantityOnHand).toBe(1);
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(0);
    const auditRows = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, interruptedFixture.id));
    expect(
      auditRows.some(
        (event) => event.eventType === "commerce.pathao_booking_interrupted",
      ),
    ).toBe(true);
    expect(
      provider.requests.filter(
        ({ url, method }) =>
          url.endsWith("/aladdin/api/v1/orders") && method === "POST",
      ),
    ).toHaveLength(1);
    expect((await stockFor(interruptedFixture.variantId)).quantityOnHand).toBe(
      1,
    );
    expect(
      (await stockFor(interruptedFixture.variantId)).quantityReserved,
    ).toBe(1);
  });

  it("releases only a stale claim with no durable Pathao request row", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    await database.db.insert(orderPathaoBookingClaim).values({
      orderId: fixture.id,
      commandId: randomUUID(),
      requestFingerprint: "b".repeat(64),
      status: "submitting",
      createdAt: sql`clock_timestamp() - interval '1 minute'`,
      updatedAt: sql`clock_timestamp() - interval '1 minute'`,
    });
    expect(await app.get(PathaoService).expireInterruptedBookings()).toBe(0);
    const claims = await database.db
      .select()
      .from(orderPathaoBookingClaim)
      .where(eq(orderPathaoBookingClaim.orderId, fixture.id));
    expect(claims).toHaveLength(0);
    await dispatchOrder(fixture.id, staff.cookie).expect(201);
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
  });

  it("reuses one access token across concurrent calls and recovers an expired refresh token once", async () => {
    const provider = mockPathaoApi({ rejectRefresh: true });
    const tokenService = app.get(PathaoTokenService);
    const [first, second] = await Promise.all([
      tokenService.getAccessToken(),
      tokenService.getAccessToken(),
    ]);
    expect(first.accessToken).toBe(second.accessToken);
    expect(provider.state.tokenGrants).toEqual(["password"]);
    await database.db
      .update(pathaoApiToken)
      .set({ accessExpiresAt: sql`clock_timestamp() - interval '1 second'` });
    await tokenService.getAccessToken();
    expect(provider.state.tokenGrants).toEqual([
      "password",
      "refresh_token",
      "password",
    ]);
  });

  it("fails closed when both refresh and configured merchant credentials are rejected", async () => {
    const provider = mockPathaoApi({
      rejectRefresh: true,
      rejectPasswordAfterFirst: true,
    });
    const tokenService = app.get(PathaoTokenService);
    await tokenService.getAccessToken();
    await database.db
      .update(pathaoApiToken)
      .set({ accessExpiresAt: sql`clock_timestamp() - interval '1 second'` });
    let error: unknown;
    try {
      await tokenService.getAccessToken();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      response: { errorCode: "PATHAO_HTTP_401" },
    });
    expect(JSON.stringify(error)).not.toContain("test-only-password");
    expect(provider.state.tokenGrants).toEqual([
      "password",
      "refresh_token",
      "password",
    ]);
  });

  it("replays a committed dispatch from a fresh API process after the caller loses its response", async () => {
    const fixture = await createGuestOrder(2);
    await confirmServiceable(fixture.id);
    const commandId = randomUUID();
    const input = {
      deliveryOperator: "AARAJ Dispatch Desk",
      handoffReference: "RESTART-TEST-01",
    };
    const committed = await dispatchOrder(
      fixture.id,
      staff.cookie,
      commandId,
      input,
    ).expect(201);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        fileURLToPath(new URL("./order-dispatch-process.mjs", import.meta.url)),
        fixture.id,
        staff.id,
        commandId,
        Buffer.from(JSON.stringify(input)).toString("base64url"),
      ],
      { env: process.env, timeout: 20_000 },
    );
    expect(JSON.parse(stdout.trim())).toMatchObject({
      id: fixture.id,
      fulfillmentStatus: "dispatched",
      dispatch: committed.body.dispatch,
    });
    expect(await stockFor(fixture.variantId)).toMatchObject({
      quantityOnHand: 1,
      quantityReserved: 0,
    });
  });

  it("does not dispatch rejected or pending-review Orders", async () => {
    const rejectedFixture = await createGuestOrder(2);
    const [rejection, concurrentDispatch] = await Promise.all([
      request(app.getHttpServer())
        .post(
          `${API_V1_BASE_PATH}/orders/manage/${rejectedFixture.id}/serviceability`,
        )
        .set("Origin", origin)
        .set("Cookie", staff.cookie)
        .send({ outcome: "unserviceable", reason: "Destination not served" }),
      dispatchOrder(rejectedFixture.id, staff.cookie),
    ]);
    expect(rejection.status).toBe(201);
    expect(concurrentDispatch.status).toBe(409);
    expect((await stockFor(rejectedFixture.variantId)).quantityOnHand).toBe(2);
    expect((await stockFor(rejectedFixture.variantId)).quantityReserved).toBe(
      0,
    );

    const pendingFixture = await createGuestOrder(2);
    const pendingDispatch = await dispatchOrder(
      pendingFixture.id,
      staff.cookie,
    );
    expect(pendingDispatch.status).toBe(409);
    expect((await orderById(pendingFixture.id))?.status).toBe(
      "awaiting_confirmation",
    );
    expect((await stockFor(pendingFixture.variantId)).quantityOnHand).toBe(2);
    expect((await stockFor(pendingFixture.variantId)).quantityReserved).toBe(1);
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

  it("allows staff to review an old pending order and keeps stock reserved", async () => {
    const fixture = await createGuestOrder();
    await setOrderAge(fixture.id, 365 * 24);

    const stillPending = await orderById(fixture.id);
    expect(stillPending?.status).toBe("awaiting_confirmation");
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);

    const reviewed = await app
      .get(OrdersService)
      .reviewServiceability(fixture.id, staff.id, {
        outcome: "serviceable",
        reason: "Destination can be served",
      });

    expect(reviewed.status).toBe("confirmed");
    expect(reviewed.cancellationReason).toBeNull();
    expect((await stockFor(fixture.variantId)).quantityReserved).toBe(1);
  });

  it("preserves a historical serviceability-timeout Order", async () => {
    const fixture = await createGuestOrder();
    await createLegacyTimeoutCancellation(fixture);
    const before = await orderById(fixture.id);

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
});

function setCookieHeaders(headers: Record<string, unknown>): string[] {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}
