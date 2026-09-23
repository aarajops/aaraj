import { describe, it, expect } from 'vitest';
import {
  HealthCheckResponseSchema,
  OrderStatusSchema,
  ProductSchema,
} from './index.js';

describe('Contracts Schema Validation', () => {
  it('validates health check schema correctly', () => {
    const validHealth = {
      status: 'ok',
      service: 'araz-api',
      timestamp: new Date().toISOString(),
      version: '0.0.1',
    };
    expect(HealthCheckResponseSchema.safeParse(validHealth).success).toBe(true);

    const invalidHealth = {
      status: 'unknown',
    };
    expect(HealthCheckResponseSchema.safeParse(invalidHealth).success).toBe(false);
  });

  it('validates order status enums correctly', () => {
    expect(OrderStatusSchema.safeParse('PENDING').success).toBe(true);
    expect(OrderStatusSchema.safeParse('CONFIRMED').success).toBe(true);
    expect(OrderStatusSchema.safeParse('INVALID_STATUS').success).toBe(false);
  });

  it('validates product schema correctly', () => {
    const validProduct = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      slug: 'premium-leather-wallet',
      name: 'Premium Leather Wallet',
      price: {
        amount: 2500,
        currency: 'BDT',
      },
      stockQuantity: 50,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(ProductSchema.safeParse(validProduct).success).toBe(true);
  });
});
