import { z } from "zod";
import { API_V1_BASE_PATH } from "../platform/api-version.js";
import {
  MAX_LIST_PAGE_SIZE,
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";

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

function isSafeStorefrontHref(value: string): boolean {
  if (
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 0x20)
  ) {
    return false;
  }
  if (value.startsWith("/")) return !value.startsWith("//");
  if (!/^https:\/\//i.test(value)) return false;
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
}

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
  linkedin: httpsUrlForHosts(["linkedin.com"]).optional(),
});
export type StorefrontSocialLinks = z.infer<typeof StorefrontSocialLinksSchema>;

const StorefrontLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(40),
  href: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
      isSafeStorefrontHref,
      "Use an internal path or a secure HTTPS link.",
    ),
});
export type StorefrontLink = z.infer<typeof StorefrontLinkSchema>;
export type StorefrontFooterLink = StorefrontLink;

function compareStorefrontLinks(left: StorefrontLink, right: StorefrontLink) {
  const leftLabel = left.label.toLowerCase();
  const rightLabel = right.label.toLowerCase();
  if (leftLabel < rightLabel) return -1;
  if (leftLabel > rightLabel) return 1;
  return left.href < right.href ? -1 : left.href > right.href ? 1 : 0;
}

const StorefrontFooterLinkListSchema = StorefrontLinkSchema.array().transform(
  (links) => [...links].sort(compareStorefrontLinks),
);

export const StorefrontFooterLinkGroupsSchema = z
  .strictObject({
    about: StorefrontFooterLinkListSchema,
    policies: StorefrontFooterLinkListSchema,
  })
  .superRefine(({ about, policies }, context) => {
    for (const [group, links] of Object.entries({ about, policies })) {
      const labels = links.map(({ label }) => label.toLowerCase());
      if (new Set(labels).size !== labels.length) {
        context.addIssue({
          code: "custom",
          path: [group],
          message: "Footer link labels must be unique within a section.",
        });
      }
    }
  });
export type StorefrontFooterLinkGroups = z.infer<
  typeof StorefrontFooterLinkGroupsSchema
>;

export const StorefrontFooterCategoryIdsSchema = z
  .uuid()
  .array()
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A catalog category can appear only once in the footer.",
  });

export const StorefrontHomepageCategoryIdsSchema = z
  .uuid()
  .array()
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A catalog category can appear only once in the homepage section.",
  });

export const StorefrontHeaderNavigationItemSchema = z.strictObject({
  type: z.literal("category"),
  categoryId: z.uuid(),
});
export type StorefrontHeaderNavigationItem = z.infer<
  typeof StorefrontHeaderNavigationItemSchema
>;

export const DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG: readonly StorefrontHeaderNavigationItem[] =
  [];

export const DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS: readonly StorefrontLink[] =
  [];

export const StorefrontHeaderNavigationSchema =
  StorefrontHeaderNavigationItemSchema.array().refine(
    (items) =>
      new Set(items.map(({ categoryId }) => categoryId)).size === items.length,
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
  headerNavigation: StorefrontLinkSchema.array(),
  footerDescription: PublicTextSchema,
  footerLinks: StorefrontLinkSchema.array().max(8),
  footerLinkGroups: StorefrontFooterLinkGroupsSchema,
  footerCategoryIds: StorefrontFooterCategoryIdsSchema,
  homepageCategoriesEnabled: z.boolean().default(false),
  homepageCategoryIds: StorefrontHomepageCategoryIdsSchema.default([]),
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
    footerLinks: StorefrontLinkSchema.array().max(8).optional(),
    footerLinkGroups: StorefrontFooterLinkGroupsSchema.optional(),
    footerCategoryIds: StorefrontFooterCategoryIdsSchema.optional(),
    homepageCategoriesEnabled: z.boolean().optional(),
    homepageCategoryIds: StorefrontHomepageCategoryIdsSchema.optional(),
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
      if (settings.footerLinkGroups) return true;
      const links = settings.footerLinks ?? [];
      const labels = links.map(({ label }) => label.toLowerCase());
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

export const STOREFRONT_BANNER_PLACEMENT_HOME_HERO = "home_hero" as const;
export const STOREFRONT_BANNER_PLACEMENTS = [
  STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
] as const;
export const StorefrontBannerPlacementSchema = z.enum(
  STOREFRONT_BANNER_PLACEMENTS,
);
export type StorefrontBannerPlacement = z.infer<
  typeof StorefrontBannerPlacementSchema
>;

export const MAX_STOREFRONT_ASSET_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES = 3 * 1024 * 1024;
export const MAX_STOREFRONT_BANNER_WIDTH = 2560;
export const MAX_STOREFRONT_BANNER_HEIGHT = 1080;
export const MAX_STOREFRONT_BANNER_NAME_LENGTH = 100;
export const MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH = 250;
export const MAX_STOREFRONT_BANNER_HREF_LENGTH = 2048;
export const STOREFRONT_BANNER_CACHE = {
  revalidateSeconds: 60,
  staleWhileRevalidateSeconds: 300,
} as const;

const StorefrontBannerHrefSchema = z
  .string()
  .trim()
  .max(MAX_STOREFRONT_BANNER_HREF_LENGTH)
  .nullable()
  .refine((value) => {
    return value === null || isSafeStorefrontHref(value);
  }, "Use an internal path or a secure HTTPS URL.");

const StorefrontBannerAssetFields = z.strictObject({
  id: z.uuid(),
  width: z.number().int().positive().max(MAX_STOREFRONT_BANNER_WIDTH),
  height: z.number().int().positive().max(MAX_STOREFRONT_BANNER_HEIGHT),
  createdAt: z.iso.datetime(),
});

export const PublicStorefrontBannerAssetSchema =
  StorefrontBannerAssetFields.extend({
    src: z
      .string()
      .regex(
        new RegExp(
          `^${API_V1_BASE_PATH}/storefront/banner-assets/[0-9a-f-]{36}/[0-9a-f]{64}\\.webp$`,
        ),
      ),
  });
export type PublicStorefrontBannerAsset = z.infer<
  typeof PublicStorefrontBannerAssetSchema
>;

export const ManagedStorefrontBannerAssetSchema =
  StorefrontBannerAssetFields.extend({
    src: z
      .string()
      .regex(
        new RegExp(
          `^${API_V1_BASE_PATH}/storefront/manage/banner-assets/[0-9a-f-]{36}/[0-9a-f]{64}\\.webp$`,
        ),
      ),
  });
export type ManagedStorefrontBannerAsset = z.infer<
  typeof ManagedStorefrontBannerAssetSchema
>;

export const PublicStorefrontBannerSchema = z.strictObject({
  desktop: PublicStorefrontBannerAssetSchema,
  mobile: PublicStorefrontBannerAssetSchema.nullable(),
  altText: z.string().max(MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH),
  href: StorefrontBannerHrefSchema,
});
export type PublicStorefrontBanner = z.infer<
  typeof PublicStorefrontBannerSchema
>;

export const PublicStorefrontBannersSchema = z.strictObject({
  placement: StorefrontBannerPlacementSchema,
  banners: PublicStorefrontBannerSchema.array(),
});
export type PublicStorefrontBanners = z.infer<
  typeof PublicStorefrontBannersSchema
>;

export const StorefrontBannerSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(MAX_STOREFRONT_BANNER_NAME_LENGTH),
  placement: StorefrontBannerPlacementSchema,
  active: z.boolean(),
  desktop: ManagedStorefrontBannerAssetSchema.nullable(),
  mobile: ManagedStorefrontBannerAssetSchema.nullable(),
  altText: z.string().max(MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH),
  href: StorefrontBannerHrefSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
});
export type StorefrontBanner = z.infer<typeof StorefrontBannerSchema>;

export const StorefrontBannerListQuerySchema =
  OffsetPaginationQuerySchema.extend({
    search: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().trim().min(1).max(160).optional(),
    ),
    status: z.enum(["active", "draft"]).optional(),
  });
export type StorefrontBannerListQuery = z.infer<
  typeof StorefrontBannerListQuerySchema
>;

export const StorefrontBannerPageSchema = z.strictObject({
  banners: StorefrontBannerSchema.array().max(MAX_LIST_PAGE_SIZE),
  ...OffsetPaginationMetadataSchema.shape,
});
export type StorefrontBannerPage = z.infer<typeof StorefrontBannerPageSchema>;

export const StorefrontBannerOrderSchema = z
  .strictObject({
    placement: StorefrontBannerPlacementSchema,
    bannerIds: z.array(z.uuid()).min(1),
  })
  .superRefine(({ bannerIds }, context) => {
    if (new Set(bannerIds).size !== bannerIds.length) {
      context.addIssue({
        code: "custom",
        path: ["bannerIds"],
        message: "Each banner can appear only once.",
      });
    }
  });
export type StorefrontBannerOrder = z.infer<typeof StorefrontBannerOrderSchema>;

const StorefrontBannerInputFields = z.strictObject({
  name: z.string().trim().min(1).max(MAX_STOREFRONT_BANNER_NAME_LENGTH),
  placement: StorefrontBannerPlacementSchema,
  active: z.boolean(),
  desktopAssetId: z.uuid().nullable(),
  mobileAssetId: z.uuid().nullable(),
  altText: z.string().trim().max(MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH),
  href: StorefrontBannerHrefSchema,
});

function validateStorefrontBannerInput(
  value: z.infer<typeof StorefrontBannerInputFields>,
  context: z.RefinementCtx,
) {
  if (value.active && !value.desktopAssetId) {
    context.addIssue({
      code: "custom",
      path: ["desktopAssetId"],
      message: "Choose a desktop image before publishing the banner.",
    });
  }
  if (value.href && !value.altText) {
    context.addIssue({
      code: "custom",
      path: ["altText"],
      message: "Add alternative text that describes the linked banner.",
    });
  }
}

export const StorefrontBannerCreateSchema =
  StorefrontBannerInputFields.superRefine(validateStorefrontBannerInput);
export type StorefrontBannerCreate = z.infer<
  typeof StorefrontBannerCreateSchema
>;

export const StorefrontBannerUpdateSchema = StorefrontBannerInputFields.extend({
  expectedVersion: z.number().int().positive(),
}).superRefine(validateStorefrontBannerInput);
export type StorefrontBannerUpdate = z.infer<
  typeof StorefrontBannerUpdateSchema
>;

/** Cursor page bound for the banner asset picker; independent of table pages. */
export const STOREFRONT_BANNER_ASSET_PAGE_SIZE = 50;

export const StorefrontBannerAssetPageSchema = z.strictObject({
  assets: ManagedStorefrontBannerAssetSchema.array().max(
    STOREFRONT_BANNER_ASSET_PAGE_SIZE,
  ),
  nextCursor: z.uuid().nullable(),
});
export type StorefrontBannerAssetPage = z.infer<
  typeof StorefrontBannerAssetPageSchema
>;

export const StorefrontBannerAssetCursorSchema = z.uuid();

export const StorefrontBannerAssetUploadSchema = z.strictObject({
  commandId: z.uuid(),
});
export type StorefrontBannerAssetUpload = z.infer<
  typeof StorefrontBannerAssetUploadSchema
>;
