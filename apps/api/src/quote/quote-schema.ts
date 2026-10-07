import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth-schema.js";
import { deliveryTariff } from "../delivery/delivery-schema.js";
import {
  geographyLocation,
  geographySnapshot,
} from "../geography/geography-schema.js";
import { taxProfile } from "../tax/tax-schema.js";

export const quoteSchema = pgSchema("quote");

export const quoteSnapshot = quoteSchema.table(
  "snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    customerId: text("customer_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    guestCartHash: text("guest_cart_hash"),
    cartRevision: bigint("cart_revision", { mode: "number" }).notNull(),
    geographyVersion: text("geography_version")
      .notNull()
      .references(() => geographySnapshot.version, { onDelete: "restrict" }),
    divisionId: uuid("division_id").notNull(),
    divisionName: text("division_name").notNull(),
    districtId: uuid("district_id").notNull(),
    districtName: text("district_name").notNull(),
    upazilaId: uuid("upazila_id"),
    upazilaName: text("upazila_name"),
    deliveryTariffVersion: text("delivery_tariff_version")
      .notNull()
      .references(() => deliveryTariff.version, { onDelete: "restrict" }),
    deliveryTariffEffectiveFrom: date("delivery_tariff_effective_from", {
      mode: "string",
    }).notNull(),
    deliveryAmountBdt: bigint("delivery_amount_bdt", {
      mode: "number",
    }).notNull(),
    taxProfileVersion: text("tax_profile_version")
      .notNull()
      .references(() => taxProfile.version, { onDelete: "restrict" }),
    taxSourceReference: text("tax_source_reference").notNull(),
    taxSourceVersion: text("tax_source_version").notNull(),
    taxRoundingRule: text("tax_rounding_rule").notNull(),
    taxProfileSnapshot: jsonb("tax_profile_snapshot").notNull(),
    merchandiseTaxSnapshot: jsonb("merchandise_tax_snapshot").notNull(),
    deliveryTaxSnapshot: jsonb("delivery_tax_snapshot").notNull(),
    lines: jsonb("lines").notNull(),
    merchandiseGrossBdt: bigint("merchandise_gross_bdt", {
      mode: "number",
    }).notNull(),
    totalTaxAmountBdt: bigint("total_tax_amount_bdt", {
      mode: "number",
    }).notNull(),
    totalBdt: bigint("total_bdt", { mode: "number" }).notNull(),
    validityPolicyVersion: text("validity_policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.geographyVersion, table.divisionId],
      foreignColumns: [geographyLocation.snapshotVersion, geographyLocation.id],
      name: "quote_division_geography_fk",
    }),
    foreignKey({
      columns: [table.geographyVersion, table.districtId],
      foreignColumns: [geographyLocation.snapshotVersion, geographyLocation.id],
      name: "quote_district_geography_fk",
    }),
    foreignKey({
      columns: [table.geographyVersion, table.upazilaId],
      foreignColumns: [geographyLocation.snapshotVersion, geographyLocation.id],
      name: "quote_upazila_geography_fk",
    }),
    index("snapshot_customer_created_idx").on(
      table.customerId,
      table.createdAt,
    ),
    index("snapshot_guest_created_idx").on(
      table.guestCartHash,
      table.createdAt,
    ),
    check("snapshot_schema_version_check", sql`${table.schemaVersion} = 1`),
    check(
      "snapshot_owner_check",
      sql`(${table.customerId} is not null and ${table.guestCartHash} is null) or (${table.customerId} is null and ${table.guestCartHash} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "snapshot_cart_revision_check",
      sql`${table.cartRevision} between 0 and 9007199254740991`,
    ),
    check(
      "snapshot_amount_check",
      sql`${table.deliveryAmountBdt} between 1 and 9007199254740991 and ${table.merchandiseGrossBdt} between 0 and 9007199254740991 and ${table.totalTaxAmountBdt} between 0 and 9007199254740991 and ${table.totalBdt} between 1 and 9007199254740991 and ${table.totalBdt} = ${table.merchandiseGrossBdt} + ${table.deliveryAmountBdt}`,
    ),
    check(
      "snapshot_expiry_check",
      sql`${table.expiresAt} = ${table.createdAt} + interval '15 minutes'`,
    ),
    check(
      "snapshot_quote_policy_check",
      sql`${table.validityPolicyVersion} = 'AARAJ_QUOTE_VALIDITY_2026_10_07_V1'`,
    ),
    check(
      "snapshot_lines_array_check",
      sql`jsonb_typeof(${table.lines}) = 'array'`,
    ),
    check(
      "snapshot_tax_object_check",
      sql`jsonb_typeof(${table.taxProfileSnapshot}) = 'object' and jsonb_typeof(${table.merchandiseTaxSnapshot}) = 'object' and jsonb_typeof(${table.deliveryTaxSnapshot}) = 'object'`,
    ),
  ],
);
