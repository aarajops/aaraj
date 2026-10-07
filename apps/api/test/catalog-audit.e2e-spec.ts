import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { getPostgresPool } from "../src/platform/database/database-client.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { getRedisClient } from "../src/platform/redis/redis-client.js";
import {
  catalogProduct,
  catalogProductVariant,
} from "../src/catalog/catalog-schema.js";
import { getPublishedFilterOptionsCacheKey } from "../src/catalog/published-filter-cache.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-e2e-password-123";

describe("catalog and security audit", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let owner: Account;
  let admin: Account;
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
    app = module.createNestApplication({
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
    await access.bootstrapSuperadmin(owner.id, { reason: "E2E test owner" });
    await access.changeRole(owner, admin.id, "admin", "grant", {
      reason: "E2E catalog administrator",
    });
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
      .get("/api/v1/catalog/products")
      .expect(200)
      .expect({
        products: [],
        hasMore: false,
        nextOffset: null,
        filters: { categories: [], colors: [], sizes: [] },
      });
    expect(
      await getRedisClient().get(getPublishedFilterOptionsCacheKey()),
    ).not.toBeNull();
    await request(app.getHttpServer())
      .get("/api/v1/catalog/categories")
      .expect(200)
      .expect({ categories: [] });
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?limit=101")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?limit=49")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?unexpected=value")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?audience=all")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?color=Black&color=White")
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/products?search=${"x".repeat(161)}`)
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products?search=shirt&search=tee")
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products/manage")
      .set("Cookie", customer.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/catalog/size-guides/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/size-guides/manage")
      .set("Cookie", customer.cookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/catalog/categories/manage")
      .expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/catalog/categories/manage")
      .set("Cookie", staff.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ name: "Forbidden", slug: "forbidden", reason: "Must be admin" })
      .expect(403);

    const parentCategory = await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({
        name: "Clothing",
        slug: "clothing",
        sortOrder: 10,
        reason: "Create clothing category group",
      })
      .expect(201);
    expect(
      await getRedisClient().get(getPublishedFilterOptionsCacheKey()),
    ).toBeNull();
    const leafCategory = await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({
        name: "T-shirts",
        slug: "t-shirts",
        parentId: parentCategory.body.id,
        reason: "Create T-shirt leaf category",
      })
      .expect(201);
    const unusedCategory = await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Accessories",
        slug: "accessories",
        reason: "Test administrator category access",
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${unusedCategory.body.id}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({ isActive: false, reason: "Archive unused category" })
      .expect(200);
    const activeCategories = await request(app.getHttpServer())
      .get("/api/v1/catalog/categories")
      .expect(200);
    expect(
      activeCategories.body.categories.map(
        ({ slug }: { slug: string }) => slug,
      ),
    ).not.toContain("accessories");
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${unusedCategory.body.id}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({ isActive: true, reason: "Restore unused category" })
      .expect(200);
    const categoryId = leafCategory.body.id as string;
    expect(leafCategory.body).toMatchObject({
      name: "T-shirts",
      slug: "t-shirts",
      parentId: parentCategory.body.id,
      path: "Clothing / T-shirts",
      isLeaf: true,
      isActive: true,
    });
    const managedCategories = await request(app.getHttpServer())
      .get("/api/v1/catalog/categories/manage")
      .set("Cookie", admin.cookie)
      .expect(200);
    expect(managedCategories.body.categories).toHaveLength(3);

    const parentWithInactiveChild = await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Archived hierarchy",
        slug: "archived-hierarchy",
        reason: "Check leaf options with an inactive child",
      })
      .expect(201);
    const inactiveChild = await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({
        name: "Archived child",
        slug: "archived-child",
        parentId: parentWithInactiveChild.body.id,
        reason: "Create child for leaf consistency check",
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${inactiveChild.body.id}`)
      .set("Cookie", admin.cookie)
      .set("Origin", origin)
      .send({ isActive: false, reason: "Archive the child category" })
      .expect(200);
    const inactiveChildOptions = await request(app.getHttpServer())
      .get("/api/v1/catalog/categories")
      .expect(200);
    expect(
      inactiveChildOptions.body.categories.find(
        ({ slug }: { slug: string }) => slug === "archived-hierarchy",
      ),
    ).toMatchObject({ isLeaf: false });
    expect(
      inactiveChildOptions.body.categories.map(
        ({ slug }: { slug: string }) => slug,
      ),
    ).not.toContain("archived-child");
    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "inactive-child-parent-product",
        name: "Inactive child parent product",
        audience: "unisex",
        categoryId: parentWithInactiveChild.body.id,
        reason: "Parent with an inactive child remains non-leaf",
      })
      .expect(400);
    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "invalid-parent-category-product",
        name: "Invalid category product",
        audience: "unisex",
        categoryId: parentCategory.body.id,
        reason: "Parent categories cannot be product categories",
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${parentCategory.body.id}`)
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({
        parentId: leafCategory.body.id,
        reason: "Reject category cycle",
      })
      .expect(400);

    const guide = await request(app.getHttpServer())
      .post("/api/v1/catalog/size-guides")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        name: "Aaraj classic T-shirt",
        categoryId,
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
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${categoryId}`)
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({ isActive: false, reason: "Reject category still in use" })
      .expect(409);
    await request(app.getHttpServer())
      .post("/api/v1/catalog/categories")
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({
        name: "Long sleeve T-shirts",
        slug: "long-sleeve-t-shirts",
        parentId: categoryId,
        reason: "A referenced leaf cannot become a parent",
      })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/categories/${unusedCategory.body.id}`)
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({
        parentId: categoryId,
        reason: "A referenced leaf cannot receive a child",
      })
      .expect(409);
    expect(guide.body.rows[0].measurements).toEqual(
      expect.arrayContaining([
        { key: "chest_width", valueMm: "508.00" },
        { key: "body_length", valueMm: "711.20" },
      ]),
    );
    await request(app.getHttpServer())
      .get("/api/v1/catalog/size-guides/manage?limit=10")
      .set("Cookie", staff.cookie)
      .expect("Cache-Control", "no-store")
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", customer.cookie)
      .set("Origin", origin)
      .send({
        slug: "customer-tee",
        name: "Customer tee",
        audience: "unisex",
        categoryId,
        reason: "Catalog draft",
      })
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "missing-size-tee",
        name: "Missing size tee",
        audience: "unisex",
        categoryId,
        fit: "Regular",
        sizeGuideId: guideId,
        isPublished: true,
        reason: "Reject unavailable size",
        variants: [
          {
            sku: "TEE-MISSING-S",
            color: "Black",
            sizeLabel: "S",
            price: { amountBdt: 1999 },
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "fractional-price-tee",
        name: "Fractional price tee",
        audience: "unisex",
        categoryId,
        fit: "Regular",
        sizeGuideId: guideId,
        reason: "Reject fractional BDT price",
        variants: [
          {
            sku: "TEE-FRACTIONAL-M",
            color: "Black",
            sizeLabel: "M",
            price: { amountBdt: 1999.5 },
          },
        ],
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "aaraj-draft-tee",
        name: "Aaraj Draft Tee",
        description: "Local apparel test product",
        audience: "unisex",
        categoryId,
        fit: "Regular",
        sizeGuideId: guideId,
        variants: [
          { sku: "AA-TEE-BLK-M", color: "Black", sizeLabel: "M", price: null },
        ],
        reason: "Initial catalog entry",
      })
      .expect(201);
    const createdRequestId = created.headers["x-request-id"] as
      string | undefined;
    expect(createdRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.body).toMatchObject({
      slug: "aaraj-draft-tee",
      name: "Aaraj Draft Tee",
      isPublished: false,
    });

    await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .expect(200)
      .expect({
        products: [],
        hasMore: false,
        nextOffset: null,
        filters: { categories: [], colors: [], sizes: [] },
      });
    await request(app.getHttpServer())
      .get("/api/v1/catalog/products/aaraj-draft-tee")
      .expect(404);
    const managed = await request(app.getHttpServer())
      .get("/api/v1/catalog/products/manage")
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(managed.body.products).toHaveLength(1);
    expect(managed.body.products[0].id).toBe(created.body.id);
    const managedDetail = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/manage/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .expect(200);
    expect(managedDetail.body.variants).toHaveLength(1);
    expect(managedDetail.body.variants[0].price).toBeNull();
    expect(managedDetail.body.sizeGuide.id).toBe(guideId);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ isPublished: true, reason: "Reject a missing variant price" })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        variants: [
          {
            sku: "TEE-M-1",
            color: "Black",
            sizeLabel: "M",
            price: null,
          },
          {
            sku: "TEE-M-2",
            color: " black ",
            sizeLabel: "m",
            price: null,
          },
        ],
        reason: "Reject duplicate color size",
      })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "duplicate-sku-tee",
        name: "Duplicate SKU Tee",
        audience: "men",
        categoryId,
        variants: [
          {
            sku: "aa-tee-blk-m",
            color: "White",
            sizeLabel: "M",
            price: null,
          },
        ],
        reason: "Reject reused SKU",
      })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ isPublished: true, reason: "Approved for storefront" })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        variants: [
          {
            sku: "AA-TEE-BLK-M",
            color: "Black",
            sizeLabel: "M",
            price: { amountBdt: 1999 },
          },
        ],
        isPublished: true,
        reason: "Set price and publish product",
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${created.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        name: "Aaraj City Tee",
        fabricComposition: "100% cotton",
        careInstructions: "ঠান্ডা পানিতে হাতে ধুতে হবে",
        reason: "Corrected product details",
      })
      .expect(200);

    const publicProduct = await request(app.getHttpServer())
      .get("/api/v1/catalog/products/aaraj-draft-tee")
      .expect(200);
    expect(publicProduct.body.name).toBe("Aaraj City Tee");
    expect(publicProduct.body.variants).toHaveLength(1);
    expect(publicProduct.body.price).toEqual({ amountBdt: 1999 });
    expect(publicProduct.body.variants[0]).not.toHaveProperty("price");
    expect(publicProduct.body.variants[0]).not.toHaveProperty("sku");
    expect(publicProduct.body.sizeGuide.rows).toHaveLength(2);
    expect(publicProduct.body.fabricComposition).toBe("100% cotton");

    await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "aaraj-city-shirt",
        name: "Aaraj City Shirt",
        audience: "men",
        categoryId,
        fit: "Regular",
        sizeGuideId: guideId,
        variants: [
          {
            sku: "AA-TEE-WHT-L",
            color: "White",
            sizeLabel: "L",
            price: { amountBdt: 2499 },
          },
        ],
        isPublished: true,
        reason: "Second item for pagination coverage",
      })
      .expect(201);

    const variantFilterProbe = await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        slug: "variant-filter-probe",
        name: "Variant Filter Probe",
        audience: "unisex",
        categoryId,
        fit: "Regular",
        sizeGuideId: guideId,
        variants: [
          {
            sku: "AA-PROBE-BLK-M",
            color: "Black",
            sizeLabel: "M",
            price: { amountBdt: 1999 },
          },
          {
            sku: "AA-PROBE-blk-L",
            color: "black",
            sizeLabel: "L",
            price: { amountBdt: 2399 },
          },
          {
            sku: "AA-PROBE-WHT-L",
            color: "White",
            sizeLabel: "L",
            price: { amountBdt: 2199 },
          },
          {
            sku: "AA-PROBE-RED-M",
            color: "Red",
            sizeLabel: "M",
            price: { amountBdt: 2299 },
          },
        ],
        isPublished: true,
        reason: "Test filters against individual variants",
      })
      .expect(201);

    const literalPercentSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "%" })
      .expect(200);
    expect(
      literalPercentSearch.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toEqual(["aaraj-draft-tee"]);

    const unicodeSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "হাতে ধুতে" })
      .expect(200);
    expect(
      unicodeSearch.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toEqual(["aaraj-draft-tee"]);

    const escapedUnderscoreSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "Aaraj_" })
      .expect(200);
    expect(escapedUnderscoreSearch.body.products).toEqual([]);

    const searchPage = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "aaraj city", limit: 1, offset: 0 })
      .expect(200);
    expect(searchPage.body.products).toHaveLength(1);
    expect(searchPage.body.hasMore).toBe(true);
    const nextSearchPage = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "aaraj city", limit: 1, offset: 1 })
      .expect(200);
    expect(nextSearchPage.body.products).toHaveLength(1);
    expect(nextSearchPage.body.products[0].id).not.toBe(
      searchPage.body.products[0].id,
    );

    const combinedSearchAndFilter = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "aaraj city", audience: "men" })
      .expect(200);
    expect(
      combinedSearchAndFilter.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toEqual(["aaraj-city-shirt"]);

    const descriptionSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "LOCAL APPAREL" })
      .expect(200);
    expect(
      descriptionSearch.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toContain("aaraj-draft-tee");

    const fitSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "regular" })
      .expect(200);
    expect(
      fitSearch.body.products.map((product: { slug: string }) => product.slug),
    ).toContain("aaraj-draft-tee");

    const maximumLengthSearch = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .query({ search: "x".repeat(160) })
      .expect(200);
    expect(maximumLengthSearch.body.products).toEqual([]);

    const unisexTshirts = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?audience=unisex&category=t-shirts")
      .expect(200);
    expect(
      unisexTshirts.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toEqual(
      expect.arrayContaining(["aaraj-draft-tee", "variant-filter-probe"]),
    );

    const matchingVariant = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?color=black&size=m")
      .expect(200);
    expect(
      matchingVariant.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toEqual(
      expect.arrayContaining(["aaraj-draft-tee", "variant-filter-probe"]),
    );

    const matchingLargeVariant = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?color=black&size=l")
      .expect(200);
    expect(
      matchingLargeVariant.body.products.map(
        (product: { slug: string }) => product.slug,
      ),
    ).toContain("variant-filter-probe");

    for (const query of ["color=white&size=m"]) {
      const noMatchingVariant = await request(app.getHttpServer())
        .get(`/api/v1/catalog/products?${query}`)
        .expect(200);
      expect(noMatchingVariant.body.products).toEqual([]);
    }

    const filterOptions = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .expect(200);
    expect(filterOptions.body.filters).toMatchObject({
      categories: expect.arrayContaining([
        expect.objectContaining({ slug: "clothing", path: "Clothing" }),
        expect.objectContaining({
          slug: "t-shirts",
          path: "Clothing / T-shirts",
        }),
      ]),
      sizes: ["L", "M"],
    });
    expect(
      filterOptions.body.filters.colors.map((color: string) =>
        color.toLowerCase(),
      ),
    ).toEqual(["black", "red", "white"]);
    const listedProbe = filterOptions.body.products.find(
      (product: { slug: string }) => product.slug === "variant-filter-probe",
    );
    const probeDetail = await request(app.getHttpServer())
      .get("/api/v1/catalog/products/variant-filter-probe")
      .expect(200);
    expect(probeDetail.body.price).toEqual(listedProbe.price);
    expect(
      probeDetail.body.variants.map(
        ({ color, sizeLabel }: { color: string; sizeLabel: string }) =>
          `${color.toLowerCase()}:${sizeLabel}`,
      ),
    ).toEqual(["black:M", "black:L", "red:M", "white:L"]);
    const parentCategoryProducts = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?category=clothing")
      .expect(200);
    expect(parentCategoryProducts.body.products.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${variantFilterProbe.body.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        variants: [
          {
            sku: "AA-PROBE-BLK-M",
            color: "Black",
            sizeLabel: "M",
            price: { amountBdt: 1999 },
          },
        ],
        reason: "Remove unavailable test variants",
      })
      .expect(200);
    const activeOnlyFilters = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?color=red")
      .expect(200);
    expect(activeOnlyFilters.body.products).toEqual([]);
    expect(activeOnlyFilters.body.filters.colors).not.toContain("Red");

    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/size-guides/${guideId}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({
        name: "Aaraj incomplete chart",
        categoryId,
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
      .get("/api/v1/catalog/products?limit=1")
      .expect(200);
    expect(firstProductPage.body.products).toHaveLength(1);
    expect(firstProductPage.body.hasMore).toBe(true);
    expect(firstProductPage.body.nextOffset).toBe(1);
    const secondProductPage = await request(app.getHttpServer())
      .get(
        `/api/v1/catalog/products?limit=1&offset=${firstProductPage.body.nextOffset}`,
      )
      .expect(200);
    expect(secondProductPage.body.products).toHaveLength(1);
    expect(secondProductPage.body.hasMore).toBe(true);
    expect(secondProductPage.body.nextOffset).toBe(2);
    expect(secondProductPage.body.products[0].id).not.toBe(
      firstProductPage.body.products[0].id,
    );
    const thirdProductPage = await request(app.getHttpServer())
      .get(
        `/api/v1/catalog/products?limit=1&offset=${secondProductPage.body.nextOffset}`,
      )
      .expect(200);
    expect(thirdProductPage.body.products).toHaveLength(1);
    expect(thirdProductPage.body.hasMore).toBe(false);
    expect(thirdProductPage.body.nextOffset).toBeNull();
    expect(thirdProductPage.body.products[0].id).not.toBe(
      secondProductPage.body.products[0].id,
    );

    const publicList = await request(app.getHttpServer())
      .get("/api/v1/catalog/products?limit=10")
      .expect(200);
    expect(
      publicList.body.products.map((product: { slug: string }) => product.slug),
    ).toHaveLength(3);

    await request(app.getHttpServer()).get("/api/v1/audit/events").expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/audit/events")
      .set("Cookie", customer.cookie)
      .expect(403);

    const page = await request(app.getHttpServer())
      .get(
        "/api/v1/audit/events?eventType=catalog.product_updated&actorId=" +
          staff.id +
          "&limit=1",
      )
      .set("Cookie", owner.cookie)
      .expect(200);
    const categoryAuditPage = await request(app.getHttpServer())
      .get(
        `/api/v1/audit/events?eventType=catalog.category_created&actorId=${owner.id}&limit=10`,
      )
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(categoryAuditPage.body.events).toHaveLength(2);
    expect(
      categoryAuditPage.body.events.map(
        (event: { subjectType: string }) => event.subjectType,
      ),
    ).toEqual(["catalog_category", "catalog_category"]);
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
        `/api/v1/audit/events?eventType=catalog.product_updated&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(tamperedCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get(
        `/api/v1/audit/events?eventType=catalog.product_created&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
      )
      .set("Cookie", owner.cookie)
      .expect(400);
    let updateCursor: string | null = page.body.nextCursor;
    let remainingUpdateCount = 0;
    while (updateCursor) {
      const updatePage = await request(app.getHttpServer())
        .get(
          `/api/v1/audit/events?eventType=catalog.product_updated&actorId=${staff.id}&limit=1&cursor=${encodeURIComponent(updateCursor)}`,
        )
        .set("Cookie", owner.cookie)
        .expect(200);
      expect(updatePage.body.events).toHaveLength(1);
      remainingUpdateCount += updatePage.body.events.length;
      updateCursor = updatePage.body.nextCursor;
    }
    expect(remainingUpdateCount).toBeGreaterThan(0);

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
      .get("/api/v1/audit/events?eventType=audit.cursor_probe&limit=1")
      .set("Cookie", owner.cookie)
      .expect(200);
    const secondCursorPage = await request(app.getHttpServer())
      .get(
        `/api/v1/audit/events?eventType=audit.cursor_probe&limit=1&cursor=${encodeURIComponent(firstCursorPage.body.nextCursor)}`,
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
    expect(productEvents[0]?.requestId).toBe(createdRequestId);
    const priceUpdateEvent = productEvents.find(
      (event) => event.reason === "Set price and publish product",
    );
    expect(priceUpdateEvent?.metadata).toMatchObject({
      variantPriceChanges: [
        {
          previousAmountBdt: null,
          nextAmountBdt: 1999,
        },
      ],
    });

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
    await database.db.insert(catalogProductVariant).values({
      productId: legacyProduct.id,
      sku: "LEGACY-UNPRICED-M",
      color: "Black",
      sizeLabel: "M",
      priceBdt: null,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${legacyProduct.slug}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/products/${legacyProduct.id}`)
      .set("Cookie", staff.cookie)
      .set("Origin", origin)
      .send({ isPublished: false, reason: "Unpublish legacy catalog row" })
      .expect(200);
  });
});
