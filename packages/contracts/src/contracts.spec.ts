import { describe, it, expect } from "vitest";
import {
  AccessUserIdSchema,
  AuditEventQuerySchema,
  CatalogProductSchema,
  CatalogProductCreateSchema,
  CatalogProductListQuerySchema,
  CatalogPublishedProductListQuerySchema,
  CatalogProductUpdateSchema,
  CatalogCategoryCreateSchema,
  CatalogSizeGuideCreateSchema,
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_PUBLIC_CATALOG_PAGE_SIZE,
  HealthCheckResponseSchema,
  MAX_LIST_PAGE_SIZE,
  MAX_PUBLIC_CATALOG_PAGE_SIZE,
  RoleSchema,
} from "./index.js";

describe("Contracts Schema Validation", () => {
  it("validates health check schema correctly", () => {
    const validHealth = {
      status: "ok",
      service: "aaraj-api",
      timestamp: new Date().toISOString(),
      version: "0.0.1",
    };
    expect(HealthCheckResponseSchema.safeParse(validHealth).success).toBe(true);

    const invalidHealth = {
      status: "unknown",
    };
    expect(HealthCheckResponseSchema.safeParse(invalidHealth).success).toBe(
      false,
    );
  });

  it("validates public access contracts correctly", () => {
    expect(RoleSchema.safeParse("customer").success).toBe(true);
    expect(RoleSchema.safeParse("unknown").success).toBe(false);
    expect(AccessUserIdSchema.safeParse("user_123").success).toBe(true);
    expect(AccessUserIdSchema.safeParse("user/123").success).toBe(false);
  });

  it("validates the implemented catalog product contract", () => {
    const validProduct = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      slug: "premium-leather-wallet",
      name: "Premium Leather Wallet",
      description: null,
      audience: "unisex",
      category: {
        id: "0cc175b9-c0f1-36a8-b1c3-99e269772661",
        name: "Accessories",
        slug: "accessories",
        parentId: null,
      },
      fit: null,
      fabricComposition: null,
      careInstructions: null,
      sizeGuideId: null,
      price: null,
      isPublished: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(CatalogProductSchema.safeParse(validProduct).success).toBe(true);
  });

  it("rejects duplicate or invalid clothing variants", () => {
    const product = {
      slug: "aaraj-cotton-tee",
      name: "Aaraj Cotton Tee",
      audience: "unisex",
      categoryId: "0cc175b9-c0f1-36a8-b1c3-99e269772661",
      reason: "Add the product",
      variants: [
        {
          sku: "TEE-BLK-M",
          color: "Black",
          sizeLabel: "M",
          price: null,
        },
        {
          sku: "tee-blk-m",
          color: "black",
          sizeLabel: "m",
          price: null,
        },
      ],
    };
    expect(CatalogProductCreateSchema.safeParse(product).success).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...product,
        variants: [
          {
            ...product.variants[0],
            gtin: "4006381333932",
            price: { amountBdt: 1999 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...product,
        variants: [
          {
            ...product.variants[0],
            gtin: "4006381333931",
            price: { amountBdt: 1999 },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires a whole-BDT price when a variant is priced", () => {
    const input = {
      slug: "aaraj-priced-tee",
      name: "Aaraj Priced Tee",
      audience: "unisex",
      reason: "Add a priced variant",
      variants: [
        {
          sku: "AA-TEE-BLK-M",
          color: "Black",
          sizeLabel: "M",
          price: { amountBdt: 1999 },
        },
      ],
    };
    expect(CatalogProductCreateSchema.safeParse(input).success).toBe(true);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...input,
        variants: [{ ...input.variants[0], price: { amountBdt: -1 } }],
      }).success,
    ).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...input,
        variants: [{ ...input.variants[0], price: { amountBdt: 0 } }],
      }).success,
    ).toBe(true);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...input,
        variants: [{ ...input.variants[0], price: { amountBdt: 1999.5 } }],
      }).success,
    ).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...input,
        variants: [
          { ...input.variants[0], price: { amountBdt: 2_147_483_648 } },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows staff to clear legacy apparel fields while unpublishing", () => {
    expect(
      CatalogProductUpdateSchema.safeParse({
        audience: null,
        categoryId: null,
        isPublished: false,
        reason: "Unpublish legacy item",
      }).success,
    ).toBe(true);
  });

  it("requires consistent, unique size guide rows", () => {
    const guide = {
      name: "Classic T-shirt",
      categoryId: "0cc175b9-c0f1-36a8-b1c3-99e269772661",
      fit: "Regular",
      measurementBasis: "garment",
      inputUnit: "in",
      reason: "Create reusable guide",
      rows: [
        {
          sizeLabel: "M",
          measurements: [
            { key: "chest_width", value: "20.00" },
            { key: "body_length", value: "28.00" },
          ],
        },
        {
          sizeLabel: "L",
          measurements: [
            { key: "chest_width", value: "21.00" },
            { key: "body_length", value: "29.00" },
          ],
        },
      ],
    };
    expect(CatalogSizeGuideCreateSchema.safeParse(guide).success).toBe(true);
    expect(
      CatalogSizeGuideCreateSchema.safeParse({
        ...guide,
        rows: [guide.rows[0], { ...guide.rows[1], sizeLabel: " m " }],
      }).success,
    ).toBe(false);
    expect(
      CatalogSizeGuideCreateSchema.safeParse({
        ...guide,
        rows: [
          guide.rows[0],
          { ...guide.rows[1], measurements: [{ key: "waist", value: "30" }] },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses one bounded page-size policy across list contracts", () => {
    expect(CatalogProductListQuerySchema.parse({})).toEqual({
      limit: DEFAULT_LIST_PAGE_SIZE,
      offset: 0,
    });
    expect(AuditEventQuerySchema.parse({}).limit).toBe(DEFAULT_LIST_PAGE_SIZE);
    expect(MAX_LIST_PAGE_SIZE).toBe(100);
    expect(
      CatalogProductListQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(AuditEventQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("validates public catalog filters with a storefront-specific page size", () => {
    expect(CatalogPublishedProductListQuerySchema.parse({})).toEqual({
      limit: DEFAULT_PUBLIC_CATALOG_PAGE_SIZE,
      offset: 0,
    });
    expect(DEFAULT_PUBLIC_CATALOG_PAGE_SIZE).toBe(24);
    expect(MAX_PUBLIC_CATALOG_PAGE_SIZE).toBe(48);
    expect(
      CatalogPublishedProductListQuerySchema.parse({
        limit: "48",
        offset: "24",
        audience: "unisex",
        category: " t-shirts ",
        color: " Black ",
        size: " M ",
      }),
    ).toEqual({
      limit: 48,
      offset: 24,
      audience: "unisex",
      category: "t-shirts",
      color: "Black",
      size: "M",
    });
    expect(
      CatalogPublishedProductListQuerySchema.parse({ category: "" }),
    ).toMatchObject({ limit: 24, offset: 0 });
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({ limit: 49 }).success,
    ).toBe(false);
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({ audience: "all" })
        .success,
    ).toBe(false);
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({ category: "   " })
        .success,
    ).toBe(false);
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({
        category: "x".repeat(101),
      }).success,
    ).toBe(false);
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({
        color: ["Black", "White"],
      }).success,
    ).toBe(false);
    expect(
      CatalogPublishedProductListQuerySchema.safeParse({ unexpected: "value" })
        .success,
    ).toBe(false);
  });

  it("validates managed category identities and slugs", () => {
    expect(
      CatalogCategoryCreateSchema.safeParse({
        name: "T-shirts",
        slug: "t-shirts",
        reason: "Create clothing category",
      }).success,
    ).toBe(true);
    expect(
      CatalogCategoryCreateSchema.safeParse({
        name: "T-shirts",
        slug: "T-shirts",
        reason: "Create clothing category",
      }).success,
    ).toBe(false);
  });
});
