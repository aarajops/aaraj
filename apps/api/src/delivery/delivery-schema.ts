import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  geographyLocation,
  geographySnapshot,
} from "../geography/geography-schema.js";

export const deliverySchema = pgSchema("delivery");

export const deliveryTariff = deliverySchema.table(
  "tariff",
  {
    version: text("version").primaryKey(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    geographyVersion: text("geography_version").references(
      () => geographySnapshot.version,
      { onDelete: "restrict" },
    ),
    insideDhakaFeeBdt: integer("inside_dhaka_fee_bdt"),
    suburbanFeeBdt: integer("suburban_fee_bdt"),
    outsideDhakaFeeBdt: integer("outside_dhaka_fee_bdt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "tariff_version_format_check",
      sql`${table.version} ~ '^AARAJ_DELIVERY_[0-9]{4}_[0-9]{2}_[0-9]{2}_V[1-9][0-9]*$'`,
    ),
    check(
      "tariff_effective_range_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check(
      "tariff_zone_fee_group_check",
      sql`(${table.insideDhakaFeeBdt} is null and ${table.suburbanFeeBdt} is null and ${table.outsideDhakaFeeBdt} is null and ${table.geographyVersion} is null) or (${table.insideDhakaFeeBdt} is not null and ${table.insideDhakaFeeBdt} between 1 and 2147483647 and ${table.suburbanFeeBdt} is not null and ${table.suburbanFeeBdt} between 1 and 2147483647 and ${table.outsideDhakaFeeBdt} is not null and ${table.outsideDhakaFeeBdt} between 1 and 2147483647 and ${table.geographyVersion} is not null)`,
    ),
  ],
);

export const deliveryTariffArea = deliverySchema.table(
  "tariff_area",
  {
    tariffVersion: text("tariff_version")
      .notNull()
      .references(() => deliveryTariff.version, { onDelete: "cascade" }),
    geographyVersion: text("geography_version").notNull(),
    locationId: uuid("location_id").notNull(),
    zone: text("zone").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tariffVersion, table.locationId],
    }),
    foreignKey({
      columns: [table.geographyVersion, table.locationId],
      foreignColumns: [geographyLocation.snapshotVersion, geographyLocation.id],
      name: "tariff_area_geography_fk",
    }),
    check(
      "tariff_area_zone_check",
      sql`${table.zone} in ('inside_dhaka', 'suburban', 'outside_dhaka')`,
    ),
  ],
);

export const deliveryTariffDistrict = deliverySchema.table(
  "tariff_district",
  {
    tariffVersion: text("tariff_version")
      .notNull()
      .references(() => deliveryTariff.version, { onDelete: "restrict" }),
    geographyVersion: text("geography_version").notNull(),
    districtId: uuid("district_id").notNull(),
    feeBdt: integer("fee_bdt").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tariffVersion, table.geographyVersion, table.districtId],
    }),
    foreignKey({
      columns: [table.geographyVersion, table.districtId],
      foreignColumns: [geographyLocation.snapshotVersion, geographyLocation.id],
      name: "tariff_district_geography_fk",
    }),
    uniqueIndex("tariff_district_geography_uidx").on(
      table.tariffVersion,
      table.geographyVersion,
      table.districtId,
    ),
    check(
      "tariff_district_fee_check",
      sql`${table.feeBdt} between 1 and 2147483647`,
    ),
  ],
);
