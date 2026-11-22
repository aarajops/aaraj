import { describe, expect, it } from "vitest";
import type { CatalogCombo } from "@aaraj/contracts";
import {
  assertComboSelections,
  comboHasAvailableSet,
} from "./catalog-combo.helpers.js";

const productId = "00000000-0000-4000-8000-000000000101";
const firstComponentId = "00000000-0000-4000-8000-000000000201";
const secondComponentId = "00000000-0000-4000-8000-000000000202";
const variantId = "00000000-0000-4000-8000-000000000301";

function fixedCombo(availableQuantity: number): CatalogCombo {
  const variant = {
    variantId,
    color: "Black",
    sizeLabel: "M",
    price: { amountBdt: 900 },
    compareAtPrice: null,
    inStock: availableQuantity > 0,
    availableQuantity,
  };
  return {
    selectionMode: "fixed_combo",
    price: { amountBdt: 1500 },
    itemCount: 2,
    revision: 1,
    components: [
      {
        id: firstComponentId,
        productId,
        productName: "Basic Tee",
        fixedColor: "Black",
        variants: [variant],
      },
      {
        id: secondComponentId,
        productId,
        productName: "Basic Tee",
        fixedColor: "Black",
        variants: [variant],
      },
    ],
  };
}

describe("combo selection policies", () => {
  it("counts repeated fixed pieces against the same variant's stock", () => {
    const combo = fixedCombo(1);
    const selections = [
      { componentId: firstComponentId, variantId },
      { componentId: secondComponentId, variantId },
    ];

    expect(comboHasAvailableSet(combo)).toBe(false);
    expect(() => assertComboSelections(combo, selections)).toThrow(
      "The selected quantities exceed available stock.",
    );
  });

  it("allows a repeated fixed variant only when the full set is in stock", () => {
    const combo = fixedCombo(2);
    const selections = [
      { componentId: firstComponentId, variantId },
      { componentId: secondComponentId, variantId },
    ];

    expect(comboHasAvailableSet(combo)).toBe(true);
    expect(assertComboSelections(combo, selections)).toEqual([
      { componentId: firstComponentId, selectionIndex: 0, variantId },
      { componentId: secondComponentId, selectionIndex: 1, variantId },
    ]);
    expect(() => assertComboSelections(combo, selections, 2)).toThrow(
      "The selected quantities exceed available stock.",
    );
  });
});
