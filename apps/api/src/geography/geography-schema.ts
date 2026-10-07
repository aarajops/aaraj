import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  boolean,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const geographySchema = pgSchema("geography");

export const geographySnapshot = geographySchema.table(
  "snapshot",
  {
    version: text("version").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    authority: text("authority").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    sources: jsonb("sources").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    active: boolean("active").notNull().default(false),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("snapshot_schema_version_check", sql`${table.schemaVersion} = 1`),
    check(
      "snapshot_authority_check",
      sql`${table.authority} = 'Bangladesh National Portal'`,
    ),
    check(
      "snapshot_checksum_check",
      sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "snapshot_sources_array_check",
      sql`jsonb_typeof(${table.sources}) = 'array'`,
    ),
    uniqueIndex("snapshot_one_active_uidx")
      .on(table.active)
      .where(sql`${table.active}`),
  ],
);

export const geographyLocation = geographySchema.table(
  "location",
  {
    snapshotVersion: text("snapshot_version")
      .notNull()
      .references(() => geographySnapshot.version, { onDelete: "restrict" }),
    id: uuid("id").notNull(),
    level: text("level").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotVersion, table.id] }),
    foreignKey({
      columns: [table.snapshotVersion, table.parentId],
      foreignColumns: [table.snapshotVersion, table.id],
      name: "location_parent_fk",
    }),
    uniqueIndex("location_source_uidx").on(
      table.snapshotVersion,
      table.level,
      table.sourceUrl,
    ),
    uniqueIndex("location_sibling_name_uidx").on(
      table.snapshotVersion,
      table.level,
      table.parentId,
      sql`lower(${table.name})`,
    ),
    check(
      "location_level_check",
      sql`${table.level} in ('division', 'district', 'upazila')`,
    ),
    check(
      "location_parent_shape_check",
      sql`(${table.level} = 'division' and ${table.parentId} is null) or (${table.level} in ('district', 'upazila') and ${table.parentId} is not null)`,
    ),
    check(
      "location_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check(
      "location_source_url_check",
      sql`${table.sourceUrl} ~ '^https://[a-z0-9.-]+\\.gov\\.bd(/.*)?$'`,
    ),
  ],
);
