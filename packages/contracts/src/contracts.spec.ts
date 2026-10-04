import { describe, it, expect } from "vitest";
import {
  AccessUserIdSchema,
  AuditEventQuerySchema,
  CatalogProductSchema,
  CatalogProductCreateSchema,
  CatalogProductListQuerySchema,
  CatalogProductUpdateSchema,
  CatalogSizeGuideCreateSchema,
  DEFAULT_LIST_PAGE_SIZE,
  HealthCheckResponseSchema,
  MAX_LIST_PAGE_SIZE,
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
      category: "Accessories",
      fit: null,
      fabricComposition: null,
      careInstructions: null,
      sizeGuideId: null,
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
      category: "T-shirts",
      reason: "Add the product",
      variants: [
        { sku: "TEE-BLK-M", color: "Black", sizeLabel: "M" },
        { sku: "tee-blk-m", color: "black", sizeLabel: "m" },
      ],
    };
    expect(CatalogProductCreateSchema.safeParse(product).success).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...product,
        variants: [{ ...product.variants[0], gtin: "4006381333932" }],
      }).success,
    ).toBe(false);
    expect(
      CatalogProductCreateSchema.safeParse({
        ...product,
        variants: [{ ...product.variants[0], gtin: "4006381333931" }],
      }).success,
    ).toBe(true);
  });

  it("allows staff to clear legacy apparel fields while unpublishing", () => {
    expect(
      CatalogProductUpdateSchema.safeParse({
        audience: null,
        category: null,
        isPublished: false,
        reason: "Unpublish legacy item",
      }).success,
    ).toBe(true);
  });

  it("requires consistent, unique size guide rows", () => {
    const guide = {
      name: "Classic T-shirt",
      category: "T-shirts",
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
});
