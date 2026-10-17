import { z } from "zod";
import { API_V1_BASE_PATH } from "../platform/api-version.js";

export const STOREFRONT_SETTINGS_ID = "default" as const;
export const DEFAULT_STOREFRONT_BACKGROUND_COLOR = "#fafafafa";
export const DEFAULT_STOREFRONT_BRAND_COLOR = "#7b2220";

const StoreNameSchema = z.string().trim().min(1).max(80);
const StorefrontHexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const AnnouncementTextSchema = z.string().trim().min(1).max(160).nullable();
const StorefrontPhoneSchema = z
  .string()
  .regex(/^\+[1-9][0-9]{7,14}$/, "Use an international E.164 phone number.")
  .nullable();
const StorefrontEmailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .nullable();
const PublicTextSchema = z.string().trim().min(1).max(500).nullable();

function httpsUrlForHosts(hosts: readonly string[]) {
  return z
    .string()
    .trim()
    .max(2048)
    .pipe(z.url())
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return (
          parsed.protocol === "https:" &&
          parsed.username.length === 0 &&
          parsed.password.length === 0 &&
          hosts.some(
            (host) =>
              parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
          )
        );
      } catch {
        return false;
      }
    }, "Use a secure URL for the matching social network.")
    .nullable();
}

export const StorefrontSocialLinksSchema = z.strictObject({
  instagram: httpsUrlForHosts(["instagram.com"]),
  facebook: httpsUrlForHosts(["facebook.com", "fb.com"]),
  tiktok: httpsUrlForHosts(["tiktok.com"]),
  youtube: httpsUrlForHosts(["youtube.com", "youtu.be"]),
  x: httpsUrlForHosts(["x.com", "twitter.com"]),
});
export type StorefrontSocialLinks = z.infer<typeof StorefrontSocialLinksSchema>;

const StorefrontLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(40),
  href: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return false;
      if (value.startsWith("/")) return !value.startsWith("//");
      try {
        const parsed = new URL(value);
        return (
          parsed.protocol === "https:" &&
          parsed.username.length === 0 &&
          parsed.password.length === 0
        );
      } catch {
        return false;
      }
    }, "Use an internal path or a secure HTTPS link."),
});
export type StorefrontLink = z.infer<typeof StorefrontLinkSchema>;
export type StorefrontFooterLink = StorefrontLink;

export const StorefrontHeaderNavigationItemSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("link"),
      ...StorefrontLinkSchema.shape,
    }),
    z.strictObject({
      type: z.literal("category"),
      categoryId: z.uuid(),
    }),
  ],
);
export type StorefrontHeaderNavigationItem = z.infer<
  typeof StorefrontHeaderNavigationItemSchema
>;

export const DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG = [
  { type: "link", label: "Products", href: "/" },
] as const satisfies readonly StorefrontHeaderNavigationItem[];

export const DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS =
  DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG.flatMap((item) =>
    item.type === "link" ? [{ label: item.label, href: item.href }] : [],
  ) satisfies readonly StorefrontLink[];

export const StorefrontHeaderNavigationSchema =
  StorefrontHeaderNavigationItemSchema.array()
    .max(8)
    .refine(
      (items) => {
        const categoryIds = items.flatMap((item) =>
          item.type === "category" ? [item.categoryId] : [],
        );
        return new Set(categoryIds).size === categoryIds.length;
      },
      { message: "A category can appear only once in header navigation." },
    );

export const StorefrontBrandAssetKindSchema = z.enum([
  "logo",
  "brandIcon",
  "favicon",
  "socialImage",
]);
export type StorefrontBrandAssetKind = z.infer<
  typeof StorefrontBrandAssetKindSchema
>;

export const StorefrontBrandAssetSchema = z.strictObject({
  id: z.uuid(),
  src: z
    .string()
    .regex(
      new RegExp(
        `^${API_V1_BASE_PATH}/storefront/assets/[0-9a-f-]{36}/[0-9a-f]{64}\\.(?:webp|png|jpg)$`,
      ),
    ),
  contentType: z.enum(["image/webp", "image/png", "image/jpeg"]),
  width: z.number().int().positive().max(1200),
  height: z.number().int().positive().max(1200),
});
export type StorefrontBrandAsset = z.infer<typeof StorefrontBrandAssetSchema>;
export const StorefrontBrandIconAssetSchema = StorefrontBrandAssetSchema.extend(
  {
    contentType: z.literal("image/png"),
    width: z.literal(1024),
    height: z.literal(1024),
  },
);

export const PublicStorefrontSettingsSchema = z.strictObject({
  siteName: StoreNameSchema,
  brandColor: StorefrontHexColorSchema,
  backgroundColor: StorefrontHexColorSchema,
  seoTitle: z.string().trim().min(1).max(160).nullable(),
  seoDescription: PublicTextSchema,
  announcementEnabled: z.boolean(),
  announcementText: AnnouncementTextSchema,
  supportPhone: StorefrontPhoneSchema,
  supportEmail: StorefrontEmailSchema,
  businessAddress: PublicTextSchema,
  logo: StorefrontBrandAssetSchema.nullable(),
  brandIcon: StorefrontBrandIconAssetSchema.nullable(),
  favicon: StorefrontBrandAssetSchema.nullable(),
  socialImage: StorefrontBrandAssetSchema.nullable(),
  socialImageAlt: z.string().trim().min(1).max(250).nullable(),
  socialLinks: StorefrontSocialLinksSchema,
  headerNavigation: StorefrontLinkSchema.array().max(8),
  footerDescription: PublicTextSchema,
  footerLinks: StorefrontLinkSchema.array().max(8),
});
export type PublicStorefrontSettings = z.infer<
  typeof PublicStorefrontSettingsSchema
>;

export const StorefrontSettingsSchema = PublicStorefrontSettingsSchema.extend({
  headerNavigation: StorefrontHeaderNavigationSchema,
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime().nullable(),
});
export type StorefrontSettings = z.infer<typeof StorefrontSettingsSchema>;

export const StorefrontSettingsUpdateSchema = z
  .strictObject({
    siteName: StoreNameSchema,
    brandColor: StorefrontHexColorSchema,
    backgroundColor: StorefrontHexColorSchema,
    seoTitle: z.string().trim().min(1).max(160).nullable(),
    seoDescription: PublicTextSchema,
    announcementEnabled: z.boolean(),
    announcementText: AnnouncementTextSchema,
    supportPhone: StorefrontPhoneSchema,
    supportEmail: StorefrontEmailSchema,
    businessAddress: PublicTextSchema,
    socialImageAlt: z.string().trim().min(1).max(250).nullable(),
    socialLinks: StorefrontSocialLinksSchema,
    headerNavigation: StorefrontHeaderNavigationSchema,
    footerDescription: PublicTextSchema,
    footerLinks: StorefrontLinkSchema.array().max(8),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (settings) => !settings.announcementEnabled || settings.announcementText,
    {
      path: ["announcementText"],
      message: "An announcement is required when the banner is enabled.",
    },
  )
  .refine(
    (settings) => {
      const labels = settings.footerLinks.map(({ label }) =>
        label.toLowerCase(),
      );
      return new Set(labels).size === labels.length;
    },
    {
      path: ["footerLinks"],
      message: "Footer link labels must be unique.",
    },
  );
export type StorefrontSettingsUpdate = z.infer<
  typeof StorefrontSettingsUpdateSchema
>;

export const StorefrontBrandAssetUploadSchema = z.strictObject({
  commandId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type StorefrontBrandAssetUpload = z.infer<
  typeof StorefrontBrandAssetUploadSchema
>;

export const StorefrontBrandAssetClearSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type StorefrontBrandAssetClear = z.infer<
  typeof StorefrontBrandAssetClearSchema
>;
