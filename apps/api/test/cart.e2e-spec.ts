import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { beforeEach, vi } from "vitest";
import { API_V1_BASE_PATH, MAX_CART_LINES } from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { CartService } from "../src/cart/cart.service.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import {
  cartMergeReceipt,
  customerCart,
  customerCartLine,
} from "../src/cart/cart-schema.js";
import {
  catalogProduct,
  catalogProductVariant,
} from "../src/catalog/catalog-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { getRedisClient } from "../src/platform/redis/redis-client.js";

type Account = { id: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-cart-e2e-password-123";
const cookieName = "aaraj_guest_cart";

describe("storefront cart", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let customer: Account;
  let otherCustomer: Account;
  let variants: Array<{ id: string }>;

  async function createAccount(name: string): Promise<Account> {
    const response = await auth.api.signUpEmail({
      body: {
        name,
        email: `${name}-${randomUUID()}@cart-e2e.example`,
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

  function cartGet(cookie?: string) {
    let call = request(app.getHttpServer()).get(`${API_V1_BASE_PATH}/cart`);
    if (cookie) call = call.set("Cookie", cookie);
    return call;
  }

  async function createGuestCart() {
    const response = await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variants[0]!.id}`)
      .set("Origin", origin)
      .send({ revision: 0, quantity: 1 })
      .expect(200);
    const setCookie = response.headers["set-cookie"]?.[0] as string | undefined;
    if (!setCookie) throw new Error("Guest cart did not set its cookie.");
    const cookie = setCookie.split(";")[0]!;
    const raw = decodeURIComponent(cookie.slice(cookieName.length + 1));
    const guestId = raw.split(".")[0]?.replace(/^s:/, "");
    if (!guestId)
      throw new Error("Guest cart cookie has no opaque identifier.");
    return { cookie, guestId, cart: response };
  }

  function guestSet(
    cookie: string,
    variantId: string,
    quantity: number,
    revision: number,
  ) {
    return request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .send({ quantity, revision });
  }

  function customerSet(
    account: Account,
    variantId: string,
    quantity: number,
    revision: number,
  ) {
    return request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .send({ quantity, revision });
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
    customer = await createAccount("cart-customer");
    otherCustomer = await createAccount("cart-other-customer");

    const [product] = await database.db
      .insert(catalogProduct)
      .values({
        slug: `cart-product-${randomUUID()}`,
        name: "Cart E2E product",
        isPublished: true,
      })
      .returning();
    if (!product) throw new Error("Could not create the Cart E2E product.");
    const skuPrefix = randomUUID().slice(0, 8);
    variants = await database.db
      .insert(catalogProductVariant)
      .values(
        Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({
          productId: product.id,
          sku: `CART-${skuPrefix}-${index}`,
          color: `Color ${index}`,
          sizeLabel: "M",
          priceBdt: 250,
        })),
      )
      .returning({ id: catalogProductVariant.id });
  });

  beforeEach(async () => {
    const prefix = process.env.THROTTLER_REDIS_KEY_PREFIX;
    if (!prefix) throw new Error("The E2E throttler prefix is missing.");
    const redis = getRedisClient();
    const keys = await redis.keys(`{${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("does not allocate on anonymous reads and protects guest mutations with CSRF and a signed cookie", async () => {
    const redis = getRedisClient();
    const beforeKeys = await redis.keys(
      `${process.env.CART_REDIS_KEY_PREFIX}*`,
    );
    await cartGet()
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          schemaVersion: 1,
          currency: "BDT",
          revision: 0,
          lines: [],
        });
      });
    expect(await redis.keys(`${process.env.CART_REDIS_KEY_PREFIX}*`)).toEqual(
      beforeKeys,
    );

    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variants[0]!.id}`)
      .set("Origin", "https://attacker.example")
      .send({ revision: 0, quantity: 1 })
      .expect(403);

    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variants[0]!.id}`)
      .set("Origin", origin)
      .send({
        revision: 0,
        quantity: 1,
        unitPriceBdt: 1,
        customerId: customer.id,
      })
      .expect(400);

    const created = await createGuestCart();
    expect(created.cart.body.lines[0]).toMatchObject({
      variantId: variants[0]!.id,
      quantity: 1,
      product: { unitPriceBdt: 250, name: "Cart E2E product" },
    });
    expect(created.cart.body.lines[0].product).not.toHaveProperty("sku");
    const setCookie = created.cart.headers["set-cookie"]?.[0] as string;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");

    const key = `${process.env.CART_REDIS_KEY_PREFIX}${created.guestId}`;
    expect(await redis.ttl(key)).toBeGreaterThan(6 * 24 * 60 * 60);
    await redis.expire(key, 600);
    await cartGet(created.cookie).expect(200);
    expect(await redis.ttl(key)).toBe(600);

    const second = await guestSet(created.cookie, variants[0]!.id, 2, 1).expect(
      200,
    );
    expect(second.body.revision).toBe(2);
    expect(await redis.ttl(key)).toBeGreaterThan(6 * 24 * 60 * 60);
    await guestSet(created.cookie, variants[0]!.id, 3, 1)
      .expect(409)
      .expect(({ body }) =>
        expect(body.errorCode).toBe("CART_REVISION_CONFLICT"),
      );

    const tampered = created.cookie.replace(/.$/, "x");
    await cartGet(tampered)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual([]);
      });
    await cartGet(created.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines[0].quantity).toBe(2);
      });

    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 300 })
      .where(eq(catalogProductVariant.id, variants[0]!.id));
    await cartGet(created.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body.lines[0].product.unitPriceBdt).toBe(250),
      );
    await guestSet(created.cookie, variants[0]!.id, 2, 2)
      .expect(200)
      .expect(({ body }) => {
        expect(body.revision).toBe(3);
        expect(body.lines[0].product.unitPriceBdt).toBe(300);
      });
    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 250 })
      .where(eq(catalogProductVariant.id, variants[0]!.id));

    await redis.del(key);
    await cartGet(created.cookie)
      .expect(200)
      .expect(({ body }) => expect(body.lines).toEqual([]));
    await redis.set(
      key,
      JSON.stringify({
        schemaVersion: 2,
        currency: "BDT",
        revision: 0,
        lines: [],
      }),
      "EX",
      600,
    );
    await cartGet(created.cookie)
      .expect(500)
      .expect(({ body }) => expect(body.errorCode).toBe("CART_DATA_INVALID"));

    await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/cart`)
      .set("Cookie", created.cookie)
      .set("Origin", "https://attacker.example")
      .expect(403);

    await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/cart`)
      .set("Cookie", created.cookie)
      .set("Origin", origin)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ revision: 1, lines: [] });
      });
    await guestSet(created.cookie, variants[0]!.id, 1, 0)
      .expect(409)
      .expect(({ body }) => {
        expect(body.errorCode).toBe("CART_REVISION_CONFLICT");
        expect(body.currentRevision).toBe(1);
      });
  });

  it("enforces the approved quantity and distinct-line caps without partial writes", async () => {
    const { cookie } = await createGuestCart();
    const overQuantity = await guestSet(cookie, variants[0]!.id, 11, 1);
    expect(overQuantity.status).toBe(400);
    const { guestId } = await (async () => {
      const signed = decodeURIComponent(cookie.slice(cookieName.length + 1));
      return { guestId: signed.split(".")[0]!.replace(/^s:/, "") };
    })();
    let revision = 1;
    for (let index = 1; index < MAX_CART_LINES; index += 1) {
      const response = await guestSet(cookie, variants[index]!.id, 1, revision);
      expect(response.status).toBe(200);
      revision = response.body.revision as number;
    }
    const overflow = await guestSet(
      cookie,
      variants[MAX_CART_LINES]!.id,
      1,
      revision,
    );
    expect(overflow.status).toBe(409);
    expect(overflow.body.errorCode).toBe("CART_LIMIT_EXCEEDED");
    const current = await cartGet(cookie).expect(200);
    expect(current.body.lines).toHaveLength(MAX_CART_LINES);
    expect(current.body.revision).toBe(revision);
    expect(
      await getRedisClient().exists(
        `${process.env.CART_REDIS_KEY_PREFIX}${guestId}`,
      ),
    ).toBe(1);
  });

  it("persists customer carts by owner and merges once even when Redis cleanup fails", async () => {
    await customerSet(customer, variants[0]!.id, 2, 0).expect(200);
    await cartGet(customer.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toHaveLength(1);
        expect(body.lines[0].quantity).toBe(2);
      });
    await cartGet(otherCustomer.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual([]);
      });

    const guest = await createGuestCart();
    await guestSet(guest.cookie, variants[0]!.id, 3, 1).expect(200);
    const redis = getRedisClient();
    const evalSpy = vi
      .spyOn(redis, "eval")
      .mockRejectedValueOnce(new Error("simulated Redis cleanup failure"));
    try {
      const merged = await app
        .get(CartService)
        .mergeGuestCart(customer.id, guest.guestId);
      expect(merged).toMatchObject({
        guestCartCleanupPending: true,
        cart: { lines: [{ variantId: variants[0]!.id, quantity: 5 }] },
      });
    } finally {
      evalSpy.mockRestore();
    }

    const receipts = await database.db.select().from(cartMergeReceipt);
    expect(receipts).toHaveLength(1);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/cart/merge`)
      .set("Cookie", `${customer.cookie}; ${guest.cookie}`)
      .set("Origin", origin)
      .expect(201)
      .expect(({ body }) => {
        expect(body.guestCartCleanupPending).toBe(false);
        expect(body.cart.lines[0].quantity).toBe(5);
      });
    const [savedCart] = await database.db
      .select({ id: customerCart.id })
      .from(customerCart)
      .where(eq(customerCart.customerId, customer.id));
    const savedLines = await database.db
      .select()
      .from(customerCartLine)
      .where(eq(customerCartLine.cartId, savedCart!.id));
    expect(savedLines).toHaveLength(1);
    expect(savedLines[0]?.quantity).toBe(5);
    expect(
      await redis.exists(
        `${process.env.CART_REDIS_KEY_PREFIX}${guest.guestId}`,
      ),
    ).toBe(0);
  });

  it("returns only current display fields from legacy customer snapshots", async () => {
    const account = await createAccount("cart-legacy-snapshot-customer");
    await customerSet(account, variants[0]!.id, 1, 0).expect(200);
    const [cart] = await database.db
      .select({ id: customerCart.id })
      .from(customerCart)
      .where(eq(customerCart.customerId, account.id));
    await database.db
      .update(customerCartLine)
      .set({
        productSnapshot: sql`${customerCartLine.productSnapshot} || ${JSON.stringify(
          {
            productId: randomUUID(),
            sku: "LEGACY-INTERNAL-SKU",
          },
        )}::jsonb`,
      })
      .where(eq(customerCartLine.cartId, cart!.id));

    await cartGet(account.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines[0].product).toMatchObject({
          name: "Cart E2E product",
          unitPriceBdt: 250,
        });
        expect(Object.keys(body.lines[0].product).sort()).toEqual([
          "color",
          "currency",
          "name",
          "sizeLabel",
          "slug",
          "unitPriceBdt",
        ]);
      });
  });

  it("clears an unreadable customer cart without resetting its revision", async () => {
    const account = await createAccount("cart-corrupt-customer");
    await customerSet(account, variants[0]!.id, 1, 0).expect(200);
    const [cart] = await database.db
      .select({ id: customerCart.id })
      .from(customerCart)
      .where(eq(customerCart.customerId, account.id));
    await database.db
      .update(customerCartLine)
      .set({
        productSnapshot: sql`${JSON.stringify({ invalid: true })}::jsonb`,
      })
      .where(eq(customerCartLine.cartId, cart!.id));

    await cartGet(account.cookie)
      .expect(500)
      .expect(({ body }) => expect(body.errorCode).toBe("CART_DATA_INVALID"));
    await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/cart`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ revision: 2, lines: [] });
      });
    await customerSet(account, variants[0]!.id, 1, 1)
      .expect(409)
      .expect(({ body }) => {
        expect(body.errorCode).toBe("CART_REVISION_CONFLICT");
        expect(body.currentRevision).toBe(2);
      });
  });

  it("enforces approved quantity and distinct-line caps on customer carts", async () => {
    const account = await createAccount("cart-limits-customer");
    const invalidQuantity = await customerSet(account, variants[0]!.id, 11, 0);
    expect(invalidQuantity.status).toBe(400);
    let revision = 0;
    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      const response = await customerSet(
        account,
        variants[index]!.id,
        1,
        revision,
      );
      expect(response.status).toBe(200);
      revision = response.body.revision as number;
    }
    const overflow = await customerSet(
      account,
      variants[MAX_CART_LINES]!.id,
      1,
      revision,
    );
    expect(overflow.status).toBe(409);
    expect(overflow.body.errorCode).toBe("CART_LIMIT_EXCEEDED");
    await cartGet(account.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toHaveLength(MAX_CART_LINES);
        expect(body.revision).toBe(revision);
      });
  });

  it("serializes simultaneous guest merges without duplicating a line", async () => {
    const account = await createAccount("cart-concurrent-merge-customer");
    const guest = await createGuestCart();
    await guestSet(guest.cookie, variants[2]!.id, 2, 1).expect(200);
    const service = app.get(CartService);
    const [first, second] = await Promise.all([
      service.mergeGuestCart(account.id, guest.guestId),
      service.mergeGuestCart(account.id, guest.guestId),
    ]);
    expect(first.cart.lines).toEqual(second.cart.lines);
    expect(first.cart.lines).toHaveLength(2);
    expect(first.cart.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: variants[0]!.id, quantity: 1 }),
        expect.objectContaining({ variantId: variants[2]!.id, quantity: 2 }),
      ]),
    );
    const guestHash = createHash("sha256").update(guest.guestId).digest("hex");
    const receipts = await database.db
      .select()
      .from(cartMergeReceipt)
      .where(eq(cartMergeReceipt.guestCartHash, guestHash));
    expect(receipts).toHaveLength(1);
  });

  it("preserves both carts when PostgreSQL fails before the merge commit", async () => {
    const account = await createAccount("cart-failed-merge-customer");
    const guest = await createGuestCart();
    const service = app.get(CartService);
    const transactionSpy = vi
      .spyOn(database.db, "transaction")
      .mockRejectedValueOnce(new Error("simulated PostgreSQL failure"));
    try {
      await expect(
        service.mergeGuestCart(account.id, guest.guestId),
      ).rejects.toThrow("simulated PostgreSQL failure");
    } finally {
      transactionSpy.mockRestore();
    }

    await cartGet(account.cookie)
      .expect(200)
      .expect(({ body }) => expect(body.lines).toEqual([]));
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/cart/guest`)
      .set("Cookie", guest.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variantId: variants[0]!.id,
              quantity: 1,
            }),
          ]),
        );
      });
  });

  it("rejects an over-cap merge atomically and allows removing an unavailable guest line", async () => {
    const conflictCustomer = await createAccount("cart-conflict-customer");
    await customerSet(conflictCustomer, variants[1]!.id, 8, 0).expect(200);
    const guest = await createGuestCart();
    const guestVariant = variants[1]!;
    const guestLine = await guestSet(
      guest.cookie,
      guestVariant.id,
      3,
      1,
    ).expect(200);
    const overflow = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/cart/merge`)
      .set("Cookie", `${conflictCustomer.cookie}; ${guest.cookie}`)
      .set("Origin", origin)
      .expect(409);
    expect(overflow.body.errorCode).toBe("CART_LIMIT_EXCEEDED");
    await cartGet(conflictCustomer.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variantId: guestVariant.id,
              quantity: 8,
            }),
          ]),
        );
      });
    await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/cart/guest`)
      .set("Cookie", guest.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variantId: guestVariant.id,
              quantity: 3,
            }),
          ]),
        );
      });

    await database.db
      .update(catalogProductVariant)
      .set({ isActive: false })
      .where(eq(catalogProductVariant.id, guestVariant.id));
    const unavailable = await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/cart/merge`)
      .set("Cookie", `${conflictCustomer.cookie}; ${guest.cookie}`)
      .set("Origin", origin)
      .expect(409);
    expect(unavailable.body.errorCode).toBe("CART_VARIANT_UNAVAILABLE");
    await request(app.getHttpServer())
      .delete(`${API_V1_BASE_PATH}/cart/guest/lines/${guestVariant.id}`)
      .query({ revision: guestLine.body.revision })
      .set("Cookie", guest.cookie)
      .set("Origin", origin)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual([
          expect.objectContaining({ variantId: variants[0]!.id, quantity: 1 }),
        ]);
      });
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/cart/merge`)
      .set("Cookie", `${conflictCustomer.cookie}; ${guest.cookie}`)
      .set("Origin", origin)
      .expect(201);
    await cartGet(conflictCustomer.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.lines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variantId: guestVariant.id,
              quantity: 8,
            }),
          ]),
        );
      });
  });

  it("keeps authenticated cart reads independent of guest Redis storage", async () => {
    await customerSet(otherCustomer, variants[2]!.id, 4, 0).expect(200);
    const redis = getRedisClient();
    const getSpy = vi
      .spyOn(redis, "get")
      .mockRejectedValueOnce(new Error("guest Redis unavailable"));
    try {
      const cart = await app
        .get(CartService)
        .getCart(otherCustomer.id, undefined);
      expect(cart.lines[0]?.quantity).toBe(4);
    } finally {
      getSpy.mockRestore();
    }
  });
});
