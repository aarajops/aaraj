import { describe, expect, it } from "vitest";
import { calculateInclusiveTaxBdt } from "./inclusive-tax.js";

describe("inclusive BDT tax calculation", () => {
  it("extracts a rational tax component with integer half-up rounding", () => {
    expect(
      calculateInclusiveTaxBdt({
        grossAmountBdt: 100,
        treatment: "taxable",
        rateNumerator: 3,
        rateDenominator: 17,
      }),
    ).toEqual({ taxableBaseBdt: 85, taxAmountBdt: 15 });
  });

  it("rounds half up without binary floating-point money arithmetic", () => {
    expect(
      calculateInclusiveTaxBdt({
        grossAmountBdt: 1,
        treatment: "taxable",
        rateNumerator: 1,
        rateDenominator: 1,
      }),
    ).toEqual({ taxableBaseBdt: 0, taxAmountBdt: 1 });
  });

  it("keeps exempt treatment distinct from an implicit zero rate", () => {
    expect(
      calculateInclusiveTaxBdt({
        grossAmountBdt: 81,
        treatment: "exempt",
        rateNumerator: null,
        rateDenominator: null,
      }),
    ).toEqual({ taxableBaseBdt: 81, taxAmountBdt: 0 });
    expect(() =>
      calculateInclusiveTaxBdt({
        grossAmountBdt: 81,
        treatment: "exempt",
        rateNumerator: 0,
        rateDenominator: 1,
      }),
    ).toThrow();
  });
});
