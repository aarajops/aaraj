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
} from "@aaraj/contracts";
import { user } from "../auth/auth-schema.js";

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

export const cartMergeReceipt = cartSchema.table(
  "merge_receipt",
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
      "cart_merge_receipt_hash_check",
      sql`${table.guestCartHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "cart_merge_receipt_revision_check",
      sql`${table.guestRevision} between 0 and ${sql.raw(String(Number.MAX_SAFE_INTEGER))}`,
    ),
  ],
);
