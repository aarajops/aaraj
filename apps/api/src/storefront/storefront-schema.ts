import { sql } from "drizzle-orm";
import {
  check,
  boolean,
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
    check("brand_asset_kind_check", sql`${table.kind} in ('logo', 'favicon')`),
    check(
      "brand_asset_kind_content_type_check",
      sql`(${table.kind} = 'logo' and ${table.contentType} = 'image/webp') or (${table.kind} = 'favicon' and ${table.contentType} = 'image/png')`,
    ),
    check(
      "brand_asset_object_key_check",
      sql`${table.objectKey} ~ '^published/storefront/(logo|favicon)/[0-9a-f-]{36}/[0-9a-f]{64}\\.(webp|png)$'`,
    ),
    check(
      "brand_asset_source_sha256_check",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("brand_asset_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "brand_asset_size_check",
      sql`${table.sizeBytes} between 1 and 3145728`,
    ),
    check(
      "brand_asset_dimensions_check",
      sql`(${table.kind} = 'logo' and ${table.width} between 1 and 1200 and ${table.height} between 1 and 400) or (${table.kind} = 'favicon' and ${table.width} = 64 and ${table.height} = 64)`,
    ),
  ],
);

export const storefrontConfiguration = storefrontSchema.table(
  "configuration",
  {
    id: text("id").primaryKey().default("default"),
    siteName: text("site_name").notNull().default("AARAJ"),
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
    faviconAssetId: uuid("favicon_asset_id").references(
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
    footerDescription: text("footer_description"),
    footerLinks: jsonb("footer_links")
      .$type<Array<{ label: string; href: string }>>()
      .notNull()
      .default([]),
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
    check("configuration_version_check", sql`${table.version} > 0`),
    check(
      "configuration_update_actor_check",
      sql`(${table.updatedAt} is null and ${table.updatedBy} is null) or (${table.updatedAt} is not null and ${table.updatedBy} is not null)`,
    ),
  ],
);
