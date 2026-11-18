import { z } from "zod";

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
    components: z
      .array(CatalogComboComponentInputSchema)
      .min(2)
      .max(MAX_COMBO_COMPONENTS),
  })
  .check(({ value, issues }) => {
    const productIds = new Set<string>();
    value.components.forEach((component, index) => {
      if (productIds.has(component.productId)) {
        issues.push({
          code: "custom",
          path: ["components", index, "productId"],
          message: "Choose each component product only once.",
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
  });
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
});

export const CatalogComboComponentSchema = z.strictObject({
  id: z.uuid(),
  productId: z.uuid(),
  productName: z.string().min(1).max(160),
  fixedColor: z.string().min(1).max(80).nullable(),
  variants: z.array(CatalogComboVariantOptionSchema).min(1).max(200),
});

export const CatalogComboSchema = z.strictObject({
  selectionMode: CatalogComboSelectionModeSchema,
  price: ComboPriceSchema,
  revision: z.number().int().positive(),
  components: z
    .array(CatalogComboComponentSchema)
    .min(2)
    .max(MAX_COMBO_COMPONENTS),
});
export type CatalogCombo = z.infer<typeof CatalogComboSchema>;

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
        price: ComboPriceSchema.nullable(),
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
