import { z } from "zod";

export const CatalogProductSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const CatalogProductSchema = z.strictObject({
  id: z.uuid(),
  slug: CatalogProductSlugSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(5000).nullable(),
  isPublished: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export const CatalogProductCreateSchema = z.strictObject({
  slug: CatalogProductSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  isPublished: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500),
});
export type CatalogProductCreateInput = z.input<
  typeof CatalogProductCreateSchema
>;

export const CatalogProductUpdateSchema = z
  .strictObject({
    slug: CatalogProductSlugSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    isPublished: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    ({ reason: _reason, ...changes }) => Object.keys(changes).length > 0,
    { message: "At least one product field must change." },
  );
export type CatalogProductUpdateInput = z.input<
  typeof CatalogProductUpdateSchema
>;

export const CatalogProductListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type CatalogProductListQuery = z.infer<
  typeof CatalogProductListQuerySchema
>;
export const CatalogProductIdSchema = z.uuid();
