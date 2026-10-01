import { describe, it, expect } from "vitest";
import {
  AuditEventQuerySchema,
  CatalogProductListQuerySchema,
  DEFAULT_LIST_PAGE_SIZE,
  HealthCheckResponseSchema,
  MAX_LIST_PAGE_SIZE,
  OrderStatusSchema,
  ProductSchema,
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

  it("validates order status enums correctly", () => {
    expect(OrderStatusSchema.safeParse("PENDING").success).toBe(true);
    expect(OrderStatusSchema.safeParse("CONFIRMED").success).toBe(true);
    expect(OrderStatusSchema.safeParse("INVALID_STATUS").success).toBe(false);
  });

  it("validates product schema correctly", () => {
    const validProduct = {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      slug: "premium-leather-wallet",
      name: "Premium Leather Wallet",
      price: {
        amount: 2500,
        currency: "BDT",
      },
      stockQuantity: 50,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(ProductSchema.safeParse(validProduct).success).toBe(true);
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
