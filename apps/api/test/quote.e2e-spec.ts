import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { beforeEach } from "vitest";
import {
  API_V1_BASE_PATH,
  BANGLADESH_GEOGRAPHY_VERSION,
  type BangladeshGeography,
} from "@aaraj/contracts";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { bangladeshBusinessDate } from "../src/delivery/delivery.service.js";
import {
  deliveryTariff,
  deliveryTariffDistrict,
} from "../src/delivery/delivery-schema.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import {
  catalogProduct,
  catalogProductVariant,
} from "../src/catalog/catalog-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { quoteSnapshot } from "../src/quote/quote-schema.js";
import { taxProfile } from "../src/tax/tax-schema.js";

const origin = "http://localhost:3000";
const password = "aaraj-quote-e2e-password-123";
const guestCookieName = "aaraj_guest_cart";

type Account = { id: string; cookie: string };

describe("authoritative Bangladesh quotes", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let variantId: string;
  let variantPrice = 250;
  let geography: BangladeshGeography;
  let dhaka: BangladeshGeography["locations"][number];
  let dhakaDivision: BangladeshGeography["locations"][number];
  let chattogram: BangladeshGeography["locations"][number];
  let chattogramDivision: BangladeshGeography["locations"][number];

  async function account(name: string): Promise<Account> {
    const response = await auth.api.signUpEmail({
      body: {
        name,
        email: `${name}-${randomUUID()}@quote-e2e.example`,
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

  async function newGuestCart() {
    const response = await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
      .set("Origin", origin)
      .send({ revision: 0, quantity: 1 })
      .expect(200);
    const cookieHeader = response.headers["set-cookie"]?.[0] as
      string | undefined;
    if (!cookieHeader)
      throw new Error("Guest cart did not issue its signed cookie.");
    const cookie = cookieHeader.split(";")[0]!;
    const encoded = cookie.slice(guestCookieName.length + 1);
    if (!decodeURIComponent(encoded).split(".")[0]) {
      throw new Error("Guest cart cookie does not contain an id.");
    }
    return { cookie };
  }

  function quoteBody(
    divisionId = dhakaDivision.id,
    districtId = dhaka.id,
    upazilaId?: string,
  ) {
    return {
      geographyVersion: geography.datasetVersion,
      divisionId,
      districtId,
      ...(upazilaId ? { upazilaId } : {}),
      recipientName: "Test Recipient",
      recipientPhone: "+8801712345678",
      locality: "Test locality",
      street: "Test road",
    };
  }

  function quoteRef(divisionId = dhakaDivision.id, districtId = dhaka.id) {
    const query = new URLSearchParams({
      geographyVersion: geography.datasetVersion,
      divisionId,
      districtId,
    });
    return query;
  }

  function getQuote(id: string, cookie: string, ref = quoteRef()) {
    return request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/quotes/${id}?${ref}`)
      .set("Cookie", cookie);
  }

  async function createQuote(cookie: string, body = quoteBody()) {
    return request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send(body)
      .expect(201);
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

    const [product] = await database.db
      .insert(catalogProduct)
      .values({
        slug: `quote-product-${randomUUID()}`,
        name: "Quote E2E tee",
        isPublished: true,
      })
      .returning();
    if (!product) throw new Error("Could not create the quote E2E product.");
    const [variant] = await database.db
      .insert(catalogProductVariant)
      .values({
        productId: product.id,
        sku: `QUOTE-${randomUUID().slice(0, 8)}`,
        color: "Blue",
        sizeLabel: "M",
        priceBdt: variantPrice,
      })
      .returning({ id: catalogProductVariant.id });
    if (!variant) throw new Error("Could not create the quote E2E variant.");
    variantId = variant.id;

    const response = await request(app.getHttpServer())
      .get(`${API_V1_BASE_PATH}/geography`)
      .expect(200);
    geography = response.body as BangladeshGeography;
    dhaka = geography.locations.find(
      (location) =>
        location.level === "district" && location.name === "ঢাকা জেলা",
    )!;
    dhakaDivision = geography.locations.find(
      (location) => location.id === dhaka.parentId,
    )!;
    chattogram = geography.locations.find(
      (location) =>
        location.level === "district" && location.name === "চট্টগ্রাম জেলা",
    )!;
    chattogramDivision = geography.locations.find(
      (location) => location.id === chattogram.parentId,
    )!;
    expect(geography.datasetVersion).toBe(BANGLADESH_GEOGRAPHY_VERSION);
    if (!dhaka || !dhakaDivision || !chattogram || !chattogramDivision) {
      throw new Error("The approved Bangladesh geography rows are missing.");
    }
    const districtIds = new Set(
      geography.locations
        .filter((location) => location.level === "district")
        .map((location) => location.id),
    );
    const tariffRows = await database.db
      .select({ districtId: deliveryTariffDistrict.districtId })
      .from(deliveryTariffDistrict)
      .where(
        eq(
          deliveryTariffDistrict.tariffVersion,
          "AARAJ_DELIVERY_2026_10_07_V1",
        ),
      );
    expect(new Set(tariffRows.map(({ districtId }) => districtId))).toEqual(
      districtIds,
    );
  });

  beforeEach(async () => {
    const date = bangladeshBusinessDate();
    variantPrice = 250;
    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: variantPrice, isActive: true })
      .where(eq(catalogProductVariant.id, variantId));
    await database.db
      .update(deliveryTariff)
      .set({ effectiveFrom: "2026-10-07", effectiveTo: null })
      .where(eq(deliveryTariff.version, "AARAJ_DELIVERY_2026_10_07_V1"));
    await database.db
      .update(deliveryTariff)
      .set({ effectiveFrom: addDays(date, 1), effectiveTo: null })
      .where(
        eq(
          deliveryTariff.version,
          `AARAJ_DELIVERY_${date.replaceAll("-", "_")}_V2`,
        ),
      );
    await database.db
      .update(taxProfile)
      .set({ effectiveFrom: addDays(date, 1), effectiveTo: null })
      .where(eq(taxProfile.version, "TEST_ONLY_BD_RETAIL_TAX_RULE_V2"));
    await database.db
      .update(taxProfile)
      .set({ effectiveTo: null })
      .where(eq(taxProfile.version, "TEST_ONLY_BD_RETAIL_TAX_RULE_V1"));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("quotes Dhaka at BDT 80, keeps inclusive tax within gross prices, and reports current state", async () => {
    const guest = await newGuestCart();
    const response = await createQuote(guest.cookie);
    expect(response.body).toMatchObject({
      currency: "BDT",
      merchandiseGrossBdt: 250,
      delivery: { grossAmountBdt: 80 },
      tax: {
        profileVersion: "TEST_ONLY_BD_RETAIL_TAX_RULE_V1",
        merchandise: {
          grossAmountBdt: 250,
          taxableBaseBdt: 212,
          taxAmountBdt: 38,
        },
      },
      totalBdt: 330,
      validityPolicyVersion: "AARAJ_QUOTE_VALIDITY_2026_10_07_V1",
    });
    expect(response.body.totalBdt).toBe(
      response.body.merchandiseGrossBdt + response.body.delivery.grossAmountBdt,
    );
    expect(response.body).not.toHaveProperty("recipientName");
    expect(response.body).not.toHaveProperty("recipientPhone");
    expect(response.body).not.toHaveProperty("locality");
    expect(
      Date.parse(response.body.expiresAt) - Date.parse(response.body.createdAt),
    ).toBe(15 * 60 * 1000);
    await expect(
      database.db
        .update(quoteSnapshot)
        .set({ totalBdt: response.body.totalBdt + 1 })
        .where(eq(quoteSnapshot.id, response.body.id)),
    ).rejects.toThrow();
    const [persistedQuote] = await database.db
      .select({ totalBdt: quoteSnapshot.totalBdt })
      .from(quoteSnapshot)
      .where(eq(quoteSnapshot.id, response.body.id));
    expect(persistedQuote?.totalBdt).toBe(response.body.totalBdt);
    await getQuote(response.body.id, guest.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: "current",
          quote: { id: response.body.id },
        });
      });
    await getQuote(
      response.body.id,
      guest.cookie,
      quoteRef(chattogramDivision.id, chattogram.id),
    )
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: "stale",
          reason: "destination_requoted",
        }),
      );
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", guest.cookie)
      .send({ ...quoteBody(), deliveryAmountBdt: 0 })
      .expect(400);
  });

  it("quotes a supported non-Dhaka district at BDT 130 and rejects invalid hierarchy", async () => {
    const guest = await newGuestCart();
    const chattogramUpazila = geography.locations.find(
      (location) =>
        location.level === "upazila" && location.parentId === chattogram.id,
    );
    if (!chattogramUpazila) {
      throw new Error("The snapshot requires a Chattogram upazila.");
    }
    const quote = await createQuote(
      guest.cookie,
      quoteBody(chattogramDivision.id, chattogram.id, chattogramUpazila.id),
    );
    expect(quote.body.delivery.grossAmountBdt).toBe(130);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", guest.cookie)
      .send(quoteBody(chattogramDivision.id, dhaka.id))
      .expect(400);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", guest.cookie)
      .send(quoteBody(chattogramDivision.id, randomUUID()))
      .expect(400);
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/quotes`)
      .set("Origin", origin)
      .set("Cookie", guest.cookie)
      .send({
        ...quoteBody(dhakaDivision.id, dhaka.id, chattogramUpazila.id),
      })
      .expect(400);
  });

  it("does not accept the synthetic tax profile in production mode", async () => {
    const guest = await newGuestCart();
    const before = await database.db
      .select({ id: quoteSnapshot.id })
      .from(quoteSnapshot);
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await request(app.getHttpServer())
        .post(`${API_V1_BASE_PATH}/quotes`)
        .set("Origin", origin)
        .set("Cookie", guest.cookie)
        .send(quoteBody())
        .expect(503)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            errorCode: "TAX_PROFILE_UNAVAILABLE",
          }),
        );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
    const after = await database.db
      .select({ id: quoteSnapshot.id })
      .from(quoteSnapshot);
    expect(after).toHaveLength(before.length);
  });

  it("makes a quote stale after cart or catalog changes and reissues from current data", async () => {
    const guest = await newGuestCart();
    const initial = await createQuote(guest.cookie);
    await request(app.getHttpServer())
      .put(`${API_V1_BASE_PATH}/cart/lines/${variantId}`)
      .set("Origin", origin)
      .set("Cookie", guest.cookie)
      .send({ revision: 1, quantity: 2 })
      .expect(200);
    await getQuote(initial.body.id, guest.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: "stale", reason: "cart_changed" }),
      );

    const updatedCart = await createQuote(guest.cookie);
    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 300 })
      .where(eq(catalogProductVariant.id, variantId));
    await getQuote(updatedCart.body.id, guest.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: "stale",
          reason: "catalog_changed",
        }),
      );
    const requote = await createQuote(guest.cookie);
    expect(requote.body.lines[0].unitPriceBdt).toBe(300);
  });

  it("invalidates old quotes when the delivery tariff and tax rule versions change", async () => {
    const guest = await newGuestCart();
    const date = bangladeshBusinessDate();
    const previousDate = addDays(date, -1);
    const tariffV1 = await createQuote(guest.cookie);
    await database.db
      .update(deliveryTariff)
      .set({ effectiveFrom: previousDate, effectiveTo: date })
      .where(eq(deliveryTariff.version, "AARAJ_DELIVERY_2026_10_07_V1"));
    const tariffVersion = `AARAJ_DELIVERY_${date.replaceAll("-", "_")}_V2`;
    await database.db
      .insert(deliveryTariff)
      .values({ version: tariffVersion, effectiveFrom: date })
      .onConflictDoUpdate({
        target: deliveryTariff.version,
        set: { effectiveFrom: date, effectiveTo: null },
      });
    await database.db
      .insert(deliveryTariffDistrict)
      .values({
        tariffVersion,
        geographyVersion: geography.datasetVersion,
        districtId: dhaka.id,
        feeBdt: 81,
      })
      .onConflictDoUpdate({
        target: [
          deliveryTariffDistrict.tariffVersion,
          deliveryTariffDistrict.geographyVersion,
          deliveryTariffDistrict.districtId,
        ],
        set: { feeBdt: 81 },
      });
    await getQuote(tariffV1.body.id, guest.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: "stale",
          reason: "delivery_tariff_changed",
        }),
      );

    const taxV1 = await createQuote(guest.cookie);
    await database.db
      .update(taxProfile)
      .set({ effectiveTo: date })
      .where(eq(taxProfile.version, "TEST_ONLY_BD_RETAIL_TAX_RULE_V1"));
    await database.db
      .insert(taxProfile)
      .values({
        version: "TEST_ONLY_BD_RETAIL_TAX_RULE_V2",
        effectiveFrom: date,
        legalMerchantReference: "TEST_ONLY synthetic merchant fixture",
        registrationStatus: "not_required",
        operatingModel: "direct_retailer",
        pricePresentation: "vat_inclusive",
        productTreatment: "taxable",
        productRateNumerator: 1,
        productRateDenominator: 9,
        deliveryTreatment: "taxable",
        deliveryRateNumerator: 1,
        deliveryRateDenominator: 9,
        roundingRule: "half_up_bdt_v1",
        sourceReference: "TEST_ONLY synthetic fixture; not legal guidance",
        sourceVersion: "TEST_ONLY_V2",
        approvalReference: "TEST_ONLY_AUTOMATED_FIXTURE",
        approved: true,
        testOnly: true,
      })
      .onConflictDoUpdate({
        target: taxProfile.version,
        set: {
          effectiveFrom: date,
          effectiveTo: null,
          productRateNumerator: 1,
          productRateDenominator: 9,
          deliveryTreatment: "taxable",
          deliveryRateNumerator: 1,
          deliveryRateDenominator: 9,
        },
      });
    await getQuote(taxV1.body.id, guest.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: "stale",
          reason: "tax_rule_changed",
        }),
      );
    const taxV2 = await createQuote(guest.cookie);
    expect(taxV2.body.delivery).toMatchObject({
      grossAmountBdt: 81,
      tax: { treatment: "taxable", taxableBaseBdt: 73, taxAmountBdt: 8 },
    });
  });

  it("requires a requote after expiry and prevents a guest quote from following login merge", async () => {
    const guest = await newGuestCart();
    const quote = await createQuote(guest.cookie);
    const expiredCopy = await database.db.execute<{ id: string }>(sql`
      INSERT INTO "quote"."snapshot" (
        "id", "schema_version", "customer_id", "guest_cart_hash", "cart_revision",
        "geography_version", "division_id", "division_name", "district_id", "district_name",
        "upazila_id", "upazila_name", "delivery_tariff_version", "delivery_tariff_effective_from",
        "delivery_amount_bdt", "tax_profile_version", "tax_source_reference", "tax_source_version",
        "tax_rounding_rule", "tax_profile_snapshot", "merchandise_tax_snapshot", "delivery_tax_snapshot",
        "lines", "merchandise_gross_bdt", "total_tax_amount_bdt", "total_bdt",
        "validity_policy_version", "created_at", "expires_at"
      )
      SELECT gen_random_uuid(), "schema_version", "customer_id", "guest_cart_hash", "cart_revision",
        "geography_version", "division_id", "division_name", "district_id", "district_name",
        "upazila_id", "upazila_name", "delivery_tariff_version", "delivery_tariff_effective_from",
        "delivery_amount_bdt", "tax_profile_version", "tax_source_reference", "tax_source_version",
        "tax_rounding_rule", "tax_profile_snapshot", "merchandise_tax_snapshot", "delivery_tax_snapshot",
        "lines", "merchandise_gross_bdt", "total_tax_amount_bdt", "total_bdt",
        "validity_policy_version", "created_at" - interval '20 minutes', "expires_at" - interval '20 minutes'
      FROM "quote"."snapshot" WHERE "id" = ${quote.body.id}
      RETURNING "id"
    `);
    const expiredId = expiredCopy.rows[0]?.id;
    if (!expiredId)
      throw new Error("Expired quote snapshot fixture was not inserted.");
    await getQuote(expiredId, guest.cookie)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("expired"));

    const customer = await account("quote-merge-customer");
    await request(app.getHttpServer())
      .post(`${API_V1_BASE_PATH}/cart/merge`)
      .set("Origin", origin)
      .set("Cookie", `${guest.cookie}; ${customer.cookie}`)
      .expect(201);
    await getQuote(quote.body.id, customer.cookie).expect(404);
  });
});

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
