import { z } from "zod";

export const CatalogCategorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const CatalogCategoryReferenceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  slug: CatalogCategorySlugSchema,
  parentId: z.uuid().nullable(),
});
export type CatalogCategoryReference = z.infer<
  typeof CatalogCategoryReferenceSchema
>;

export const CatalogCategoryOptionSchema =
  CatalogCategoryReferenceSchema.extend({
    sortOrder: z.number().int().nonnegative(),
    path: z.string().min(1).max(50_000),
    isLeaf: z.boolean(),
  });
export type CatalogCategoryOption = z.infer<typeof CatalogCategoryOptionSchema>;

export const CatalogCategorySchema = CatalogCategoryOptionSchema.extend({
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const CatalogCategoryListSchema = z.strictObject({
  categories: CatalogCategorySchema.array().max(500),
});
export type CatalogCategoryList = z.infer<typeof CatalogCategoryListSchema>;

export const CatalogCategoryOptionsSchema = z.strictObject({
  categories: CatalogCategoryOptionSchema.array().max(500),
});
export type CatalogCategoryOptions = z.infer<
  typeof CatalogCategoryOptionsSchema
>;

export const CatalogCategoryCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  slug: CatalogCategorySlugSchema,
  parentId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  reason: z.string().trim().min(3).max(500),
});
export type CatalogCategoryCreateInput = z.input<
  typeof CatalogCategoryCreateSchema
>;

export const CatalogCategoryUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    slug: CatalogCategorySlugSchema.optional(),
    parentId: z.uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    ({ reason: _reason, ...changes }) => Object.keys(changes).length > 0,
    {
      message: "At least one category field must change.",
    },
  );
export type CatalogCategoryUpdateInput = z.input<
  typeof CatalogCategoryUpdateSchema
>;

export const CatalogCategoryIdSchema = z.uuid();
