import { z } from "zod";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";
import { CatalogSizeGuideSchema } from "./size-guides.js";

export const CatalogAudienceSchema = z.enum(["men", "women", "unisex"]);
export type CatalogAudience = z.infer<typeof CatalogAudienceSchema>;

export const CatalogProductSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const CatalogProductVariantInputSchema = z.strictObject({
  sku: z.string().trim().min(1).max(100),
  color: z.string().trim().min(1).max(80),
  sizeLabel: z.string().trim().min(1).max(40),
  gtin: z
    .string()
    .trim()
    .regex(/^(?:\d{8}|\d{12,14})$/)
    .refine(isValidGtin, "Enter a valid GS1 GTIN with a correct check digit.")
    .nullable()
    .optional(),
});
export type CatalogProductVariantInput = z.input<
  typeof CatalogProductVariantInputSchema
>;

export const CatalogProductVariantSchema = z.strictObject({
  id: z.uuid(),
  color: z.string(),
  sizeLabel: z.string(),
});

export const CatalogManagedProductVariantSchema =
  CatalogProductVariantSchema.extend({
    sku: z.string(),
    gtin: z.string().nullable(),
    isActive: z.boolean(),
  });

export const CatalogProductSchema = z.strictObject({
  id: z.uuid(),
  slug: CatalogProductSlugSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(5000).nullable(),
  audience: CatalogAudienceSchema.nullable(),
  category: z.string().min(1).max(80).nullable(),
  fit: z.string().min(1).max(80).nullable(),
  fabricComposition: z.string().max(1000).nullable(),
  careInstructions: z.string().max(2000).nullable(),
  sizeGuideId: z.uuid().nullable(),
  isPublished: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export const CatalogProductDetailSchema = CatalogProductSchema.extend({
  variants: CatalogProductVariantSchema.array(),
  sizeGuide: CatalogSizeGuideSchema.nullable(),
});
export type CatalogProductDetail = z.infer<typeof CatalogProductDetailSchema>;

export const CatalogManagedProductDetailSchema = CatalogProductSchema.extend({
  variants: CatalogManagedProductVariantSchema.array(),
  sizeGuide: CatalogSizeGuideSchema.nullable(),
});
export type CatalogManagedProductDetail = z.infer<
  typeof CatalogManagedProductDetailSchema
>;

const CatalogProductFieldsSchema = z.strictObject({
  slug: CatalogProductSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  audience: CatalogAudienceSchema,
  category: z.string().trim().min(1).max(80),
  fit: z.string().trim().min(1).max(80).nullable().optional(),
  fabricComposition: z.string().trim().max(1000).nullable().optional(),
  careInstructions: z.string().trim().max(2000).nullable().optional(),
  sizeGuideId: z.uuid().nullable().optional(),
  variants: z.array(CatalogProductVariantInputSchema).max(200).optional(),
  isPublished: z.boolean().optional(),
});

export const CatalogProductCreateSchema = CatalogProductFieldsSchema.extend({
  reason: z.string().trim().min(3).max(500),
}).superRefine(validateVariantInputs);
export type CatalogProductCreateInput = z.input<
  typeof CatalogProductCreateSchema
>;

export const CatalogProductUpdateSchema = CatalogProductFieldsSchema.partial()
  .extend({
    audience: CatalogAudienceSchema.nullable().optional(),
    category: z.string().trim().min(1).max(80).nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    ({ reason: _reason, ...changes }) => Object.keys(changes).length > 0,
    { message: "At least one product field must change." },
  )
  .superRefine(validateVariantInputs);
export type CatalogProductUpdateInput = z.input<
  typeof CatalogProductUpdateSchema
>;

export const CatalogProductListQuerySchema = OffsetPaginationQuerySchema;
export type CatalogProductListQuery = z.infer<
  typeof CatalogProductListQuerySchema
>;

export const CatalogProductPageSchema = z.strictObject({
  products: CatalogProductSchema.array(),
  ...OffsetPaginationMetadataSchema.shape,
});
export type CatalogProductPage = z.infer<typeof CatalogProductPageSchema>;

export const CatalogProductIdSchema = z.uuid();

function validateVariantInputs(
  input: { variants?: CatalogProductVariantInput[] },
  context: z.RefinementCtx,
) {
  const variants = input.variants ?? [];
  const skus = new Set<string>();
  const combinations = new Set<string>();

  for (const [index, variant] of variants.entries()) {
    const sku = variant.sku.trim().toLowerCase();
    const combination = `${variant.color.trim().toLowerCase()}\u0000${variant.sizeLabel.trim().toLowerCase()}`;
    if (skus.has(sku)) {
      context.addIssue({
        code: "custom",
        path: ["variants", index, "sku"],
        message: "Variant SKUs must be unique.",
      });
    }
    if (combinations.has(combination)) {
      context.addIssue({
        code: "custom",
        path: ["variants", index, "sizeLabel"],
        message: "Each color and size combination may appear only once.",
      });
    }
    skus.add(sku);
    combinations.add(combination);
  }
}

function isValidGtin(value: string): boolean {
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );
  return (10 - (sum % 10)) % 10 === checkDigit;
}
