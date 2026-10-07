import { z } from "zod";
import { API_V1_BASE_PATH } from "../platform/api-version.js";

export const MAX_CATALOG_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CATALOG_MEDIA_DERIVATIVE_BYTES = 3 * 1024 * 1024;
export const MAX_CATALOG_PRODUCT_MEDIA = 12;
export const MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY = 2;
export const CATALOG_MEDIA_RENDITIONS = {
  card: { width: 480, height: 640 },
  detail: { width: 1200, height: 1600 },
} as const;

export const CatalogMediaRenditionSchema = z.enum(["card", "detail"]);
export type CatalogMediaRendition = z.infer<typeof CatalogMediaRenditionSchema>;

export const CatalogMediaSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const CatalogMediaDerivativeSchema = z.strictObject({
  rendition: CatalogMediaRenditionSchema,
  sha256: CatalogMediaSha256Schema,
  width: z.number().int().positive().max(CATALOG_MEDIA_RENDITIONS.detail.width),
  height: z
    .number()
    .int()
    .positive()
    .max(CATALOG_MEDIA_RENDITIONS.detail.height),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_CATALOG_MEDIA_DERIVATIVE_BYTES),
});
export type CatalogMediaDerivative = z.infer<
  typeof CatalogMediaDerivativeSchema
>;

export const CatalogMediaDerivativesSchema = z
  .array(CatalogMediaDerivativeSchema)
  .max(2)
  .refine(
    (derivatives) =>
      new Set(derivatives.map(({ rendition }) => rendition)).size ===
      derivatives.length,
    "Each catalog image rendition must be unique.",
  );
export type CatalogMediaDerivatives = z.infer<
  typeof CatalogMediaDerivativesSchema
>;

export const CatalogProductImageVariantSchema = z.strictObject({
  src: z.string().startsWith(`${API_V1_BASE_PATH}/catalog/media/`),
  width: z.number().int().positive().max(CATALOG_MEDIA_RENDITIONS.detail.width),
  height: z
    .number()
    .int()
    .positive()
    .max(CATALOG_MEDIA_RENDITIONS.detail.height),
});

export const CatalogProductImageSchema = z.strictObject({
  id: z.uuid(),
  altText: z.string().min(1).max(500),
  card: CatalogProductImageVariantSchema,
  detail: CatalogProductImageVariantSchema,
});
export type CatalogProductImage = z.infer<typeof CatalogProductImageSchema>;

export const CatalogMediaContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export type CatalogMediaContentType = z.infer<
  typeof CatalogMediaContentTypeSchema
>;

export const CatalogMediaStatusSchema = z.enum([
  "uploading",
  "quarantined",
  "processing",
  "ready",
  "rejected",
  "deleting",
  "deleted",
]);
export type CatalogMediaStatus = z.infer<typeof CatalogMediaStatusSchema>;

export const CatalogMediaUploadInputSchema = z.strictObject({
  commandId: z.uuid(),
  variantId: z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((value) => value || undefined),
  altText: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(3).max(500),
});
export type CatalogMediaUploadInput = z.input<
  typeof CatalogMediaUploadInputSchema
>;

export const CatalogMediaDeleteInputSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type CatalogMediaDeleteInput = z.infer<
  typeof CatalogMediaDeleteInputSchema
>;

export const CatalogMediaSchema = z.strictObject({
  id: z.uuid(),
  commandId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  altText: z.string().min(1).max(500),
  reason: z.string().min(3).max(500),
  deletionReason: z.string().min(3).max(500).nullable(),
  contentType: CatalogMediaContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_CATALOG_MEDIA_UPLOAD_BYTES),
  sortOrder: z.number().int().nonnegative(),
  status: CatalogMediaStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogMedia = z.infer<typeof CatalogMediaSchema>;

export const CatalogProductMediaListSchema = z.strictObject({
  media: CatalogMediaSchema.array(),
});
export type CatalogProductMediaList = z.infer<
  typeof CatalogProductMediaListSchema
>;
