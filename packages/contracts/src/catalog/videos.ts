import { z } from "zod";

export const MAX_CATALOG_PRODUCT_VIDEOS = 8;
export const MAX_CATALOG_VIDEO_UPLOAD_BYTES = 536_870_912;
export const MAX_CATALOG_VIDEO_DURATION_SECONDS = 180;
export const MAX_CATALOG_VIDEO_CAPTION_BYTES = 2_097_152;

export const CatalogVideoStatusSchema = z.enum([
  "provisioning",
  "awaiting_upload",
  "processing",
  "ready",
  "error",
  "deleting",
  "deleted",
]);
export type CatalogVideoStatus = z.infer<typeof CatalogVideoStatusSchema>;

export const CatalogVideoCaptionSchema = z.strictObject({
  language: z.string().min(2).max(35),
  label: z.string().min(1).max(80),
  status: z.enum(["inprogress", "ready", "error"]),
});
export type CatalogVideoCaption = z.infer<typeof CatalogVideoCaptionSchema>;

export const CatalogManagedVideoSchema = z.strictObject({
  id: z.uuid(),
  productId: z.uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  variantColor: z.string().max(100).nullable(),
  sortOrder: z.number().int().nonnegative(),
  status: CatalogVideoStatusSchema,
  durationSeconds: z.number().positive().nullable(),
  captions: CatalogVideoCaptionSchema.array(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogManagedVideo = z.infer<typeof CatalogManagedVideoSchema>;

export const CatalogProductVideoSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  variantColor: z.string().max(100).nullable(),
  sortOrder: z.number().int().nonnegative(),
  playbackUrl: z.url(),
  durationSeconds: z.number().positive().nullable(),
  captions: CatalogVideoCaptionSchema.array(),
});
export type CatalogProductVideo = z.infer<typeof CatalogProductVideoSchema>;

export const CatalogPublishedVideoFeedSchema = z.strictObject({
  videos: CatalogProductVideoSchema.array().max(MAX_CATALOG_PRODUCT_VIDEOS),
});
export type CatalogPublishedVideoFeed = z.infer<
  typeof CatalogPublishedVideoFeedSchema
>;

export const CatalogProductVideoListSchema = z.strictObject({
  videos: CatalogManagedVideoSchema.array().max(MAX_CATALOG_PRODUCT_VIDEOS),
});
export type CatalogProductVideoList = z.infer<
  typeof CatalogProductVideoListSchema
>;

export const CatalogVideoProvisionInputSchema = z.strictObject({
  commandId: z.uuid(),
  fileSizeBytes: z.number().int().min(1).max(MAX_CATALOG_VIDEO_UPLOAD_BYTES),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  variantColor: z.string().trim().min(1).max(100).nullable().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type CatalogVideoProvisionInput = z.input<
  typeof CatalogVideoProvisionInputSchema
>;

export const CatalogVideoProvisionResultSchema = z.strictObject({
  video: CatalogManagedVideoSchema,
  uploadUrl: z.url(),
});
export type CatalogVideoProvisionResult = z.infer<
  typeof CatalogVideoProvisionResultSchema
>;

export const CatalogVideoMetadataUpdateInputSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    variantColor: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one video field must change.",
  });
export type CatalogVideoMetadataUpdateInput = z.input<
  typeof CatalogVideoMetadataUpdateInputSchema
>;

export const CatalogVideoOrderInputSchema = z
  .strictObject({
    videoIds: z.array(z.uuid()).max(MAX_CATALOG_PRODUCT_VIDEOS),
  })
  .refine(({ videoIds }) => new Set(videoIds).size === videoIds.length, {
    message: "Video IDs must be unique.",
    path: ["videoIds"],
  });
export type CatalogVideoOrderInput = z.infer<
  typeof CatalogVideoOrderInputSchema
>;

export const CatalogVideoDeleteInputSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type CatalogVideoDeleteInput = z.infer<
  typeof CatalogVideoDeleteInputSchema
>;

export const CatalogVideoLanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .refine((language) => {
    try {
      new Intl.Locale(language);
      return true;
    } catch {
      return false;
    }
  });
