import { describe, expect, it } from "vitest";
import {
  CartSetLineInputSchema,
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "./index.js";

describe("Cart policy contracts", () => {
  it("accepts the approved quantity cap and rejects values above it", () => {
    expect(
      CartSetLineInputSchema.safeParse({ revision: 0, quantity: 1 }).success,
    ).toBe(true);
    expect(
      CartSetLineInputSchema.safeParse({
        revision: 0,
        quantity: MAX_CART_QUANTITY_PER_VARIANT,
      }).success,
    ).toBe(true);
    expect(
      CartSetLineInputSchema.safeParse({
        revision: 0,
        quantity: MAX_CART_QUANTITY_PER_VARIANT + 1,
      }).success,
    ).toBe(false);
  });

  it("keeps the approved distinct-line limit as a named domain constant", () => {
    expect(MAX_CART_LINES).toBe(50);
  });

  it("rejects client supplied price and owner fields", () => {
    expect(
      CartSetLineInputSchema.safeParse({
        revision: 0,
        quantity: 1,
        unitPriceBdt: 1,
        customerId: "attacker-controlled",
      }).success,
    ).toBe(false);
  });
});
