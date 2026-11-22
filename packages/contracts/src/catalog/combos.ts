import { z } from "zod";
import {
  CatalogProductImageVariantSchema,
  MAX_CATALOG_PRODUCT_MEDIA,
} from "./media.js";

export const MAX_COMBO_COMPONENTS = 10;

const ComboPriceSchema = z.strictObject({
  amountBdt: z.number().int().nonnegative().max(2_147_483_647),
});

export const CatalogComboSelectionModeSchema = z.enum([
  "fixed_combo",
  "mix_colors_one_size",
  "mix_sizes_and_colors",
]);
export type CatalogComboSelectionMode = z.infer<
  typeof CatalogComboSelectionModeSchema
>;

export const CatalogComboComponentInputSchema = z.strictObject({
  productId: z.uuid(),
  fixedColor: z.string().trim().min(1).max(80).nullable(),
});
export type CatalogComboComponentInput = z.infer<
  typeof CatalogComboComponentInputSchema
>;

export const CatalogComboConfigurationInputSchema = z
  .strictObject({
    selectionMode: CatalogComboSelectionModeSchema,
    price: ComboPriceSchema,
    compareAtPrice: ComboPriceSchema.nullable().optional(),
    itemCount: z.number().int().min(2).max(MAX_COMBO_COMPONENTS).optional(),
    components: z
      .array(CatalogComboComponentInputSchema)
      .min(1)
      .max(MAX_COMBO_COMPONENTS),
  })
  .check(({ value, issues }) => {
    const itemCount = value.itemCount ?? value.components.length;
    const productIds = new Set<string>();
    if (
      value.compareAtPrice &&
      value.compareAtPrice.amountBdt <= value.price.amountBdt
    ) {
      issues.push({
        code: "custom",
        path: ["compareAtPrice"],
        message: "The regular price must be higher than the combo price.",
        input: value.compareAtPrice,
      });
    }
    if (itemCount < 2) {
      issues.push({
        code: "custom",
        path: ["itemCount"],
        message: "A combo must contain at least two items.",
        input: value.itemCount,
      });
    }
    if (
      value.selectionMode === "fixed_combo" &&
      value.components.length !== itemCount
    ) {
      issues.push({
        code: "custom",
        path: ["itemCount"],
        message: "A fixed combo includes every listed item.",
        input: value.itemCount,
      });
    }
    if (value.selectionMode === "fixed_combo" && value.components.length < 2) {
      issues.push({
        code: "custom",
        path: ["components"],
        message: "A fixed combo must include at least two items.",
        input: value.components,
      });
    }
    value.components.forEach((component, index) => {
      if (
        value.selectionMode !== "fixed_combo" &&
        productIds.has(component.productId)
      ) {
        issues.push({
          code: "custom",
          path: ["components", index, "productId"],
          message: "A flexible combo can list each source product only once.",
          input: component.productId,
        });
      }
      productIds.add(component.productId);
      const fixedMode = value.selectionMode === "fixed_combo";
      if (fixedMode !== (component.fixedColor !== null)) {
        issues.push({
          code: "custom",
          path: ["components", index, "fixedColor"],
          message: fixedMode
            ? "Choose a fixed color for every component."
            : "Fixed colors are only used for a fixed combo.",
          input: component.fixedColor,
        });
      }
    });
  })
  .transform((value) => ({
    ...value,
    itemCount: value.itemCount ?? value.components.length,
  }));
export type CatalogComboConfigurationInput = z.infer<
  typeof CatalogComboConfigurationInputSchema
>;

export const CatalogComboVariantOptionSchema = z.strictObject({
  variantId: z.uuid(),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  price: ComboPriceSchema,
  compareAtPrice: ComboPriceSchema.nullable(),
  inStock: z.boolean(),
  availableQuantity: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
});
export type CatalogComboVariantOption = z.infer<
  typeof CatalogComboVariantOptionSchema
>;

export const CatalogComboThumbnailSchema = z.strictObject({
  color: z.string().min(1).max(80).nullable(),
  altText: z.string().min(1).max(500),
  card: CatalogProductImageVariantSchema,
});
export type CatalogComboThumbnail = z.infer<typeof CatalogComboThumbnailSchema>;

export const CatalogComboComponentSchema = z.strictObject({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string().min(1).max(160),
  fixedColor: z.string().min(1).max(80).nullable(),
  thumbnails: z
    .array(CatalogComboThumbnailSchema)
    .max(MAX_CATALOG_PRODUCT_MEDIA)
    .optional(),
  variants: z.array(CatalogComboVariantOptionSchema).min(1).max(200),
});
export type CatalogComboComponent = z.infer<typeof CatalogComboComponentSchema>;

export const CatalogComboSchema = z.strictObject({
  selectionMode: CatalogComboSelectionModeSchema,
  price: ComboPriceSchema,
  compareAtPrice: ComboPriceSchema.nullable(),
  itemCount: z.number().int().min(2).max(MAX_COMBO_COMPONENTS),
  revision: z.number().int().positive(),
  components: z
    .array(CatalogComboComponentSchema)
    .min(1)
    .max(MAX_COMBO_COMPONENTS),
});
export type CatalogCombo = z.infer<typeof CatalogComboSchema>;

/**
 * Returns the combo's configured regular price, or the lowest regular price of
 * a complete selectable set when no combo-level price is configured. A full
 * selection uses the exact selected source variants.
 */
export function getComboRegularPrice(
  combo: CatalogCombo,
  selectedVariantIds: readonly string[] = [],
): { amountBdt: number } | null {
  if (combo.compareAtPrice) return combo.compareAtPrice;

  if (selectedVariantIds.length === combo.itemCount) {
    const variantsById = new Map(
      combo.components.flatMap((component) =>
        component.variants.map(
          (variant) => [variant.variantId, variant] as const,
        ),
      ),
    );
    let amountBdt = 0;
    for (const variantId of selectedVariantIds) {
      const variant = variantsById.get(variantId);
      if (!variant) return null;
      amountBdt += variant.compareAtPrice?.amountBdt ?? variant.price.amountBdt;
    }
    return { amountBdt };
  }

  if (combo.selectionMode === "fixed_combo") {
    const firstComponent = combo.components[0];
    if (!firstComponent) return null;
    const sizes = uniqueOptions(
      firstComponent.variants
        .filter((variant) =>
          sameOption(variant.color, firstComponent.fixedColor ?? ""),
        )
        .map(({ sizeLabel }) => sizeLabel),
    );
    const totals = sizes.flatMap((size) => {
      const demandByVariant = new Map<string, number>();
      let amountBdt = 0;
      for (const component of combo.components) {
        const variant = component.variants.find(
          (candidate) =>
            sameOption(candidate.color, component.fixedColor ?? "") &&
            sameOption(candidate.sizeLabel, size),
        );
        if (!variant || variant.availableQuantity < 1) return [];
        const demand = (demandByVariant.get(variant.variantId) ?? 0) + 1;
        if (demand > variant.availableQuantity) return [];
        demandByVariant.set(variant.variantId, demand);
        amountBdt +=
          variant.compareAtPrice?.amountBdt ?? variant.price.amountBdt;
      }
      return [amountBdt];
    });
    return minimumPrice(totals);
  }

  const sizes =
    combo.selectionMode === "mix_colors_one_size"
      ? uniqueOptions(
          combo.components.flatMap((component) =>
            component.variants.map(({ sizeLabel }) => sizeLabel),
          ),
        )
      : [null];
  const totals = sizes.flatMap((size) => {
    const options = combo.components.flatMap((component) =>
      component.variants
        .filter(
          (variant) => size === null || sameOption(variant.sizeLabel, size),
        )
        .map((variant) => ({
          amountBdt:
            variant.compareAtPrice?.amountBdt ?? variant.price.amountBdt,
          quantity: variant.availableQuantity,
        })),
    );
    const total = cheapestAvailableTotal(options, combo.itemCount);
    return total === null ? [] : [total];
  });
  return minimumPrice(totals);
}

function cheapestAvailableTotal(
  options: readonly { amountBdt: number; quantity: number }[],
  itemCount: number,
): number | null {
  let remaining = itemCount;
  let total = 0;
  for (const option of [...options].sort(
    (left, right) => left.amountBdt - right.amountBdt,
  )) {
    const quantity = Math.min(remaining, option.quantity);
    total += quantity * option.amountBdt;
    remaining -= quantity;
    if (remaining === 0) return total;
  }
  return null;
}

function minimumPrice(
  amounts: readonly number[],
): { amountBdt: number } | null {
  return amounts.length ? { amountBdt: Math.min(...amounts) } : null;
}

function uniqueOptions(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

function sameOption(left: string, right: string): boolean {
  return (
    left.trim().toLocaleLowerCase("en-US") ===
    right.trim().toLocaleLowerCase("en-US")
  );
}

export const CatalogComboManageSchema = CatalogComboSchema.extend({
  productRevision: z.number().int().positive(),
});
export type CatalogComboManage = z.infer<typeof CatalogComboManageSchema>;

export const CatalogComboCandidateSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  variants: z
    .array(
      z.strictObject({
        id: z.uuid(),
        color: z.string().min(1).max(80),
        sizeLabel: z.string().min(1).max(40),
        price: ComboPriceSchema,
      }),
    )
    .max(200),
});
export const CatalogComboCandidatesSchema = CatalogComboCandidateSchema.array();
export type CatalogComboCandidate = z.infer<typeof CatalogComboCandidateSchema>;

export const CatalogComboCandidatesQuerySchema = z.strictObject({
  search: z.string().trim().max(120).optional(),
});
export type CatalogComboCandidatesQuery = z.infer<
  typeof CatalogComboCandidatesQuerySchema
>;

export const CatalogComboSelectionSchema = z.strictObject({
  componentId: z.uuid(),
  variantId: z.uuid(),
});
export type CatalogComboSelection = z.infer<typeof CatalogComboSelectionSchema>;

export const CatalogComboSelectionsSchema = z
  .array(CatalogComboSelectionSchema)
  .min(2)
  .max(MAX_COMBO_COMPONENTS);

export const CatalogComboPurchaseSchema = z.strictObject({
  productId: z.uuid(),
  revision: z.number().int().positive(),
  selections: CatalogComboSelectionsSchema,
  quantity: z.number().int().min(1).max(10),
});
export type CatalogComboPurchase = z.infer<typeof CatalogComboPurchaseSchema>;
