import { describe, expect, it } from "vitest";
import { getComboRegularPrice, type CatalogCombo } from "./combos.js";

function variant(
  variantId: string,
  input: {
    color?: string;
    sizeLabel?: string;
    price: number;
    compareAtPrice?: number | null;
    availableQuantity?: number;
  },
): CatalogCombo["components"][number]["variants"][number] {
  return {
    variantId,
    color: input.color ?? "Black",
    sizeLabel: input.sizeLabel ?? "M",
    price: { amountBdt: input.price },
    compareAtPrice:
      input.compareAtPrice === undefined || input.compareAtPrice === null
        ? null
        : { amountBdt: input.compareAtPrice },
    inStock: (input.availableQuantity ?? 1) > 0,
    availableQuantity: input.availableQuantity ?? 1,
  };
}

function combo(
  input: Partial<CatalogCombo> &
    Pick<CatalogCombo, "selectionMode" | "itemCount" | "components">,
): CatalogCombo {
  return {
    price: { amountBdt: 100 },
    compareAtPrice: null,
    revision: 1,
    ...input,
  };
}

describe("getComboRegularPrice", () => {
  it("uses the configured combo price before source prices", () => {
    const configuredCombo = combo({
      selectionMode: "mix_sizes_and_colors",
      itemCount: 2,
      compareAtPrice: { amountBdt: 900 },
      components: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          productId: "00000000-0000-4000-8000-000000000101",
          productName: "Source",
          fixedColor: null,
          variants: [variant("variant-1", { price: 200, compareAtPrice: 400 })],
        },
      ],
    });

    expect(
      getComboRegularPrice(configuredCombo, ["variant-1", "variant-1"]),
    ).toEqual({ amountBdt: 900 });
  });

  it("uses the lowest available complete set, then the exact completed selection", () => {
    const flexibleCombo = combo({
      selectionMode: "mix_sizes_and_colors",
      itemCount: 2,
      components: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          productId: "00000000-0000-4000-8000-000000000101",
          productName: "Source",
          fixedColor: null,
          variants: [
            variant("variant-1", {
              price: 100,
              compareAtPrice: 200,
              availableQuantity: 1,
            }),
            variant("variant-2", {
              price: 300,
              availableQuantity: 3,
            }),
          ],
        },
      ],
    });

    expect(getComboRegularPrice(flexibleCombo)).toEqual({ amountBdt: 500 });
    expect(
      getComboRegularPrice(flexibleCombo, ["variant-2", "variant-2"]),
    ).toEqual({ amountBdt: 600 });
  });

  it("keeps a one-size combo baseline within a shared size", () => {
    const oneSizeCombo = combo({
      selectionMode: "mix_colors_one_size",
      itemCount: 2,
      components: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          productId: "00000000-0000-4000-8000-000000000101",
          productName: "Source",
          fixedColor: null,
          variants: [
            variant("medium", {
              sizeLabel: "M",
              price: 400,
              compareAtPrice: 500,
              availableQuantity: 2,
            }),
            variant("small", {
              sizeLabel: "S",
              price: 100,
              availableQuantity: 1,
            }),
            variant("small-other", {
              color: "Navy",
              sizeLabel: "S",
              price: 200,
              availableQuantity: 1,
            }),
          ],
        },
      ],
    });

    expect(getComboRegularPrice(oneSizeCombo)).toEqual({ amountBdt: 300 });
  });

  it("uses the cheapest shared size for a fixed combo", () => {
    const fixedCombo = combo({
      selectionMode: "fixed_combo",
      itemCount: 2,
      components: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          productId: "00000000-0000-4000-8000-000000000101",
          productName: "First source",
          fixedColor: "Brown",
          variants: [
            variant("first-medium", {
              color: "Brown",
              sizeLabel: "M",
              price: 300,
              compareAtPrice: 500,
            }),
            variant("first-large", {
              color: "Brown",
              sizeLabel: "L",
              price: 400,
              compareAtPrice: 600,
            }),
          ],
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          productId: "00000000-0000-4000-8000-000000000102",
          productName: "Second source",
          fixedColor: "Black",
          variants: [
            variant("second-medium", {
              color: "Black",
              sizeLabel: "M",
              price: 200,
              compareAtPrice: 400,
            }),
            variant("second-large", {
              color: "Black",
              sizeLabel: "L",
              price: 100,
              compareAtPrice: 200,
            }),
          ],
        },
      ],
    });

    expect(getComboRegularPrice(fixedCombo)).toEqual({ amountBdt: 800 });
  });
});
