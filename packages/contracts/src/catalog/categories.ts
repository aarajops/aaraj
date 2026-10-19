import { z } from "zod";
import { API_V1_BASE_PATH } from "../platform/api-version.js";
import { CATALOG_MEDIA_RENDITIONS } from "./media.js";

export const CatalogCategorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function getStorefrontCategoryHref(slug: string): string {
  return `/categories/${encodeURIComponent(slug)}`;
}

export const CatalogCategoryReferenceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  slug: CatalogCategorySlugSchema,
  parentId: z.uuid().nullable(),
});

export const CatalogCategoryImageSchema = z.strictObject({
  src: z
    .string()
    .regex(
      new RegExp(
        `^${API_V1_BASE_PATH}/catalog/categories/[0-9a-f-]{36}/image/[0-9a-f]{64}\\.webp$`,
      ),
    ),
  width: z.number().int().positive().max(CATALOG_MEDIA_RENDITIONS.card.width),
  height: z.number().int().positive().max(CATALOG_MEDIA_RENDITIONS.card.height),
});
export type CatalogCategoryImage = z.infer<typeof CatalogCategoryImageSchema>;
export type CatalogCategoryReference = z.infer<
  typeof CatalogCategoryReferenceSchema
>;

export const CatalogCategoryOptionSchema =
  CatalogCategoryReferenceSchema.extend({
    path: z.string().min(1).max(50_000),
    isLeaf: z.boolean(),
    image: CatalogCategoryImageSchema.nullable().optional(),
  });
export type CatalogCategoryOption = z.infer<typeof CatalogCategoryOptionSchema>;

export const CatalogCategorySchema = CatalogCategoryOptionSchema.extend({
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const CatalogCategoryListSchema = z.strictObject({
  categories: CatalogCategorySchema.array(),
});
export type CatalogCategoryList = z.infer<typeof CatalogCategoryListSchema>;

export const CatalogCategoryOptionsSchema = z.strictObject({
  categories: CatalogCategoryOptionSchema.array(),
});
export type CatalogCategoryOptions = z.infer<
  typeof CatalogCategoryOptionsSchema
>;

export const CatalogCategoryCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  slug: CatalogCategorySlugSchema,
  parentId: z.uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type CatalogCategoryCreateInput = z.input<
  typeof CatalogCategoryCreateSchema
>;

export const CatalogCategoryUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    slug: CatalogCategorySlugSchema.optional(),
    parentId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
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
