import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import {
  CART_CURRENCY,
  CART_SCHEMA_VERSION,
  MAX_CART_QUANTITY_PER_VARIANT,
  type CartProductSnapshot,
  type CartComboLine,
} from "@aaraj/contracts";
import { user } from "../auth/auth-schema.js";
import { catalogCombo } from "../catalog/catalog-schema.js";

export const cartSchema = pgSchema("cart");

export const customerCart = cartSchema.table(
  "customer_cart",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default(CART_CURRENCY),
    schemaVersion: integer("schema_version")
      .notNull()
      .default(CART_SCHEMA_VERSION),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_cart_customer_uidx").on(table.customerId),
    check("customer_cart_currency_check", sql`${table.currency} = 'BDT'`),
    check(
      "customer_cart_schema_version_check",
      sql`${table.schemaVersion} = ${sql.raw(String(CART_SCHEMA_VERSION))}`,
    ),
    check(
      "customer_cart_revision_check",
      sql`${table.revision} between 0 and ${sql.raw(String(Number.MAX_SAFE_INTEGER))}`,
    ),
  ],
);

export const customerCartLine = cartSchema.table(
  "customer_cart_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => customerCart.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    productSnapshot: jsonb("product_snapshot")
      .$type<CartProductSnapshot>()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_cart_line_variant_uidx").on(
      table.cartId,
      table.variantId,
    ),
    check(
      "customer_cart_line_quantity_check",
      sql`${table.quantity} between 1 and ${sql.raw(String(MAX_CART_QUANTITY_PER_VARIANT))}`,
    ),
    check(
      "customer_cart_line_snapshot_object_check",
      sql`jsonb_typeof(${table.productSnapshot}) = 'object'`,
    ),
  ],
);

export const customerCartComboLine = cartSchema.table(
  "customer_cart_combo_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => customerCart.id, { onDelete: "cascade" }),
    comboProductId: uuid("combo_product_id")
      .notNull()
      .references(() => catalogCombo.productId, { onDelete: "restrict" }),
    comboRevision: integer("combo_revision").notNull(),
    configurationHash: text("configuration_hash").notNull(),
    quantity: integer("quantity").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    unitPriceBdt: integer("unit_price_bdt").notNull(),
    selections: jsonb("selections")
      .$type<CartComboLine["selections"]>()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_cart_combo_line_configuration_uidx").on(
      table.cartId,
      table.configurationHash,
    ),
    check(
      "customer_cart_combo_line_revision_check",
      sql`${table.comboRevision} > 0`,
    ),
    check(
      "customer_cart_combo_line_quantity_check",
      sql`${table.quantity} between 1 and ${sql.raw(String(MAX_CART_QUANTITY_PER_VARIANT))}`,
    ),
    check(
      "customer_cart_combo_line_hash_check",
      sql`${table.configurationHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "customer_cart_combo_line_snapshot_check",
      sql`jsonb_typeof(${table.selections}) = 'array' and jsonb_array_length(${table.selections}) between 2 and 10`,
    ),
    check(
      "customer_cart_combo_line_price_check",
      sql`${table.unitPriceBdt} between 0 and 2147483647`,
    ),
  ],
);

export const guestCartRevisionReceipt = cartSchema.table(
  "guest_cart_revision_receipt",
  {
    guestCartHash: text("guest_cart_hash").notNull(),
    guestRevision: bigint("guest_revision", { mode: "number" }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guestCartHash, table.guestRevision] }),
    check(
      "guest_cart_revision_receipt_hash_check",
      sql`${table.guestCartHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "guest_cart_revision_receipt_revision_check",
      sql`${table.guestRevision} between 0 and ${sql.raw(String(Number.MAX_SAFE_INTEGER))}`,
    ),
  ],
);
