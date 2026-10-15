import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  integer,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth-schema.js";

export const storefrontSchema = pgSchema("storefront");

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
    check("configuration_version_check", sql`${table.version} > 0`),
    check(
      "configuration_update_actor_check",
      sql`(${table.updatedAt} is null and ${table.updatedBy} is null) or (${table.updatedAt} is not null and ${table.updatedBy} is not null)`,
    ),
  ],
);
