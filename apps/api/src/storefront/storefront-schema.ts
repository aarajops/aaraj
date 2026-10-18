import { sql } from "drizzle-orm";
import {
  MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES,
  MAX_STOREFRONT_BANNER_HEIGHT,
  MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH,
  MAX_STOREFRONT_BANNER_HREF_LENGTH,
  MAX_STOREFRONT_BANNER_NAME_LENGTH,
  MAX_STOREFRONT_BANNER_WIDTH,
  DEFAULT_STOREFRONT_BACKGROUND_COLOR,
  DEFAULT_STOREFRONT_BRAND_COLOR,
  DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG,
  STOREFRONT_BANNER_PLACEMENTS,
  type StorefrontFooterLinkGroups,
  type StorefrontHeaderNavigationItem,
} from "@aaraj/contracts";
import {
  check,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth-schema.js";

export const storefrontSchema = pgSchema("storefront");
const bannerPlacementSql = sql.raw(
  STOREFRONT_BANNER_PLACEMENTS.map((placement) => `'${placement}'`).join(", "),
);

export const storefrontBrandAsset = storefrontSchema.table(
  "brand_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commandId: uuid("command_id").notNull(),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("brand_asset_command_uidx").on(table.commandId),
    uniqueIndex("brand_asset_object_key_uidx").on(table.objectKey),
    check(
      "brand_asset_kind_check",
      sql`${table.kind} in ('logo', 'brandIcon', 'favicon', 'socialImage')`,
    ),
    check(
      "brand_asset_kind_content_type_check",
      sql`(${table.kind} = 'logo' and ${table.contentType} = 'image/webp') or (${table.kind} in ('brandIcon', 'favicon') and ${table.contentType} = 'image/png') or (${table.kind} = 'socialImage' and ${table.contentType} = 'image/jpeg')`,
    ),
    check(
      "brand_asset_object_key_check",
      sql`${table.objectKey} ~ '^published/storefront/(logo|brandIcon|favicon|socialImage)/[0-9a-f-]{36}/[0-9a-f]{64}\\.(webp|png|jpg)$'`,
    ),
    check(
      "brand_asset_source_sha256_check",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("brand_asset_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "brand_asset_size_check",
      sql`${table.sizeBytes} between 1 and ${sql.raw(String(MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES))}`,
    ),
    check(
      "brand_asset_dimensions_check",
      sql`(${table.kind} = 'logo' and ${table.width} between 1 and 1200 and ${table.height} between 1 and 400) or (${table.kind} = 'brandIcon' and ${table.width} = 1024 and ${table.height} = 1024) or (${table.kind} = 'favicon' and ${table.width} = 64 and ${table.height} = 64) or (${table.kind} = 'socialImage' and ${table.width} = 1200 and ${table.height} = 630)`,
    ),
  ],
);

export const storefrontBannerAsset = storefrontSchema.table(
  "banner_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commandId: uuid("command_id").notNull(),
    objectKey: text("object_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    publiclyReleasedAt: timestamp("publicly_released_at", {
      withTimezone: true,
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("banner_asset_created_at_id_idx").on(table.createdAt, table.id),
    uniqueIndex("banner_asset_command_uidx").on(table.commandId),
    uniqueIndex("banner_asset_object_key_uidx").on(table.objectKey),
    check(
      "banner_asset_object_key_check",
      sql`${table.objectKey} ~ '^published/storefront/banner/[0-9a-f-]{36}/[0-9a-f]{64}\\.webp$'`,
    ),
    check(
      "banner_asset_source_sha256_check",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("banner_asset_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "banner_asset_size_check",
      sql`${table.sizeBytes} between 1 and ${sql.raw(String(MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES))}`,
    ),
    check(
      "banner_asset_dimensions_check",
      sql`${table.width} between 1 and ${sql.raw(String(MAX_STOREFRONT_BANNER_WIDTH))} and ${table.height} between 1 and ${sql.raw(String(MAX_STOREFRONT_BANNER_HEIGHT))}`,
    ),
  ],
);

export const storefrontBanner = storefrontSchema.table(
  "banner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    placement: text("placement").notNull(),
    active: boolean("active").notNull().default(false),
    desktopAssetId: uuid("desktop_asset_id").references(
      () => storefrontBannerAsset.id,
      { onDelete: "restrict" },
    ),
    mobileAssetId: uuid("mobile_asset_id").references(
      () => storefrontBannerAsset.id,
      { onDelete: "restrict" },
    ),
    altText: text("alt_text").notNull().default(""),
    href: text("href"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("banner_placement_created_at_id_idx").on(
      table.placement,
      table.createdAt,
      table.id,
    ),
    check(
      "banner_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and ${sql.raw(String(MAX_STOREFRONT_BANNER_NAME_LENGTH))}`,
    ),
    check(
      "banner_placement_check",
      sql`${table.placement} in (${bannerPlacementSql})`,
    ),
    check(
      "banner_assets_check",
      sql`not ${table.active} or ${table.desktopAssetId} is not null`,
    ),
    check(
      "banner_alt_text_check",
      sql`${table.altText} = btrim(${table.altText}) and length(${table.altText}) <= ${sql.raw(String(MAX_STOREFRONT_BANNER_ALT_TEXT_LENGTH))}`,
    ),
    check(
      "banner_href_check",
      sql`${table.href} is null or (${table.href} = btrim(${table.href}) and length(${table.href}) between 1 and ${sql.raw(String(MAX_STOREFRONT_BANNER_HREF_LENGTH))} and ${table.href} !~ '[[:cntrl:]]' and position(E'\\\\' in ${table.href}) = 0 and ((left(${table.href}, 1) = '/' and left(${table.href}, 2) <> '//') or ${table.href} ~* '^https://[^/@?#]+(:[0-9]+)?([/?#].*)?$'))`,
    ),
    check("banner_version_check", sql`${table.version} > 0`),
    check(
      "banner_update_actor_check",
      sql`(${table.updatedAt} is null and ${table.updatedBy} is null) or (${table.updatedAt} is not null and ${table.updatedBy} is not null)`,
    ),
  ],
);

export const storefrontConfiguration = storefrontSchema.table(
  "configuration",
  {
    id: text("id").primaryKey().default("default"),
    siteName: text("site_name").notNull().default("AARAJ"),
    brandColor: text("brand_color")
      .notNull()
      .default(DEFAULT_STOREFRONT_BRAND_COLOR),
    backgroundColor: text("background_color")
      .notNull()
      .default(DEFAULT_STOREFRONT_BACKGROUND_COLOR),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    socialImageAlt: text("social_image_alt"),
    announcementEnabled: boolean("announcement_enabled")
      .notNull()
      .default(false),
    announcementText: text("announcement_text"),
    supportPhone: text("support_phone"),
    supportEmail: text("support_email"),
    businessAddress: text("business_address"),
    logoAssetId: uuid("logo_asset_id").references(
      () => storefrontBrandAsset.id,
      { onDelete: "restrict" },
    ),
    brandIconAssetId: uuid("brand_icon_asset_id").references(
      () => storefrontBrandAsset.id,
      { onDelete: "restrict" },
    ),
    faviconAssetId: uuid("favicon_asset_id").references(
      () => storefrontBrandAsset.id,
      { onDelete: "restrict" },
    ),
    socialImageAssetId: uuid("social_image_asset_id").references(
      () => storefrontBrandAsset.id,
      { onDelete: "restrict" },
    ),
    socialLinks: jsonb("social_links")
      .$type<{
        instagram: string | null;
        facebook: string | null;
        tiktok: string | null;
        youtube: string | null;
        x: string | null;
      }>()
      .notNull()
      .default({
        instagram: null,
        facebook: null,
        tiktok: null,
        youtube: null,
        x: null,
      }),
    linkedinUrl: text("linkedin_url"),
    footerDescription: text("footer_description"),
    footerLinks: jsonb("footer_links")
      .$type<Array<{ label: string; href: string }>>()
      .notNull()
      .default([]),
    footerLinkGroups: jsonb("footer_link_groups")
      .$type<StorefrontFooterLinkGroups>()
      .notNull()
      .default({ about: [], policies: [] }),
    footerCategoryIds: jsonb("footer_category_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    headerNavigation: jsonb("header_navigation")
      .$type<StorefrontHeaderNavigationItem[]>()
      .notNull()
      .default([...DEFAULT_STOREFRONT_HEADER_NAVIGATION_CONFIG]),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    check("configuration_singleton_check", sql`${table.id} = 'default'`),
    check(
      "configuration_site_name_check",
      sql`${table.siteName} = btrim(${table.siteName}) and length(${table.siteName}) between 1 and 80`,
    ),
    check(
      "configuration_brand_color_check",
      sql`${table.brandColor} ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'`,
    ),
    check(
      "configuration_background_color_check",
      sql`${table.backgroundColor} ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'`,
    ),
    check(
      "configuration_seo_title_check",
      sql`${table.seoTitle} is null or (${table.seoTitle} = btrim(${table.seoTitle}) and length(${table.seoTitle}) between 1 and 160)`,
    ),
    check(
      "configuration_seo_description_check",
      sql`${table.seoDescription} is null or (${table.seoDescription} = btrim(${table.seoDescription}) and length(${table.seoDescription}) between 1 and 500)`,
    ),
    check(
      "configuration_social_image_alt_check",
      sql`${table.socialImageAlt} is null or (${table.socialImageAlt} = btrim(${table.socialImageAlt}) and length(${table.socialImageAlt}) between 1 and 250)`,
    ),
    check(
      "configuration_announcement_text_check",
      sql`${table.announcementText} is null or (${table.announcementText} = btrim(${table.announcementText}) and length(${table.announcementText}) between 1 and 160)`,
    ),
    check(
      "configuration_announcement_enabled_check",
      sql`not ${table.announcementEnabled} or ${table.announcementText} is not null`,
    ),
    check(
      "configuration_support_phone_check",
      sql`${table.supportPhone} is null or ${table.supportPhone} ~ '^[+][1-9][0-9]{7,14}$'`,
    ),
    check(
      "configuration_support_email_check",
      sql`${table.supportEmail} is null or (${table.supportEmail} = btrim(${table.supportEmail}) and length(${table.supportEmail}) <= 254 and ${table.supportEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+$')`,
    ),
    check(
      "configuration_business_address_check",
      sql`${table.businessAddress} is null or (${table.businessAddress} = btrim(${table.businessAddress}) and length(${table.businessAddress}) between 1 and 500)`,
    ),
    check(
      "configuration_footer_description_check",
      sql`${table.footerDescription} is null or (${table.footerDescription} = btrim(${table.footerDescription}) and length(${table.footerDescription}) between 1 and 500)`,
    ),
    check(
      "configuration_social_links_check",
      sql`case when jsonb_typeof(${table.socialLinks}) = 'object' then true else false end`,
    ),
    check(
      "configuration_footer_links_check",
      sql`case when jsonb_typeof(${table.footerLinks}) = 'array' then jsonb_array_length(${table.footerLinks}) <= 8 else false end`,
    ),
    check(
      "configuration_footer_link_groups_check",
      sql`case when jsonb_typeof(${table.footerLinkGroups}) = 'object' then jsonb_typeof(${table.footerLinkGroups}->'about') = 'array' and jsonb_typeof(${table.footerLinkGroups}->'policies') = 'array' else false end`,
    ),
    check(
      "configuration_footer_category_ids_check",
      sql`jsonb_typeof(${table.footerCategoryIds}) = 'array'`,
    ),
    check(
      "configuration_header_navigation_check",
      sql`case when jsonb_typeof(${table.headerNavigation}) = 'array' then jsonb_array_length(${table.headerNavigation}) <= 8 else false end`,
    ),
    check("configuration_version_check", sql`${table.version} > 0`),
    check(
      "configuration_update_actor_check",
      sql`(${table.updatedAt} is null and ${table.updatedBy} is null) or (${table.updatedAt} is not null and ${table.updatedBy} is not null)`,
    ),
  ],
);
