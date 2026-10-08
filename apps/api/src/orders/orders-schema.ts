import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import { quoteSnapshot } from "../quote/quote-schema.js";
import { inventoryStockReservation } from "../inventory/inventory-schema.js";

export const ordersSchema = pgSchema("orders");

export const customerOrder = ordersSchema.table(
  "order_header",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reference: text("reference").notNull(),
    customerId: text("customer_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    guestCartHash: text("guest_cart_hash"),
    guestAccessTokenHash: text("guest_access_token_hash"),
    guestAccessExpiresAt: timestamp("guest_access_expires_at", {
      withTimezone: true,
    }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quoteSnapshot.id, { onDelete: "restrict" }),
    cartRevision: bigint("cart_revision", { mode: "number" }).notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => inventoryStockReservation.id, { onDelete: "restrict" }),
    addressCiphertext: text("address_ciphertext").notNull(),
    status: text("status")
      .$type<"awaiting_confirmation" | "confirmed" | "rejected" | "cancelled">()
      .notNull(),
    serviceability: text("serviceability")
      .$type<"pending_manual_review" | "serviceable" | "unserviceable">()
      .notNull(),
    paymentMethod: text("payment_method").notNull().default("cod"),
    collectionStatus: text("collection_status")
      .notNull()
      .default("uncollected"),
    fulfillmentStatus: text("fulfillment_status")
      .$type<"not_started" | "awaiting_dispatch" | "cancelled">()
      .notNull(),
    cancellationReason: text(
      "cancellation_reason",
    ).$type<"serviceability_review_timeout">(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    merchandiseGrossBdt: bigint("merchandise_gross_bdt", {
      mode: "number",
    }).notNull(),
    deliveryAmountBdt: bigint("delivery_amount_bdt", {
      mode: "number",
    }).notNull(),
    totalBdt: bigint("total_bdt", { mode: "number" }).notNull(),
    codAmountDueBdt: bigint("cod_amount_due_bdt", { mode: "number" }).notNull(),
    taxSnapshot: jsonb("tax_snapshot").notNull(),
    deliverySnapshot: jsonb("delivery_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_reference_uidx").on(table.reference),
    uniqueIndex("order_quote_uidx").on(table.quoteId),
    index("order_customer_created_idx").on(table.customerId, table.createdAt),
    index("order_status_created_idx").on(table.status, table.createdAt),
    index("order_pending_review_deadline_idx")
      .on(table.createdAt, table.id)
      .where(
        sql`${table.status} = 'awaiting_confirmation' and ${table.serviceability} = 'pending_manual_review'`,
      ),
    index("order_serviceability_created_idx").on(
      table.serviceability,
      table.createdAt,
    ),
    check(
      "order_reference_check",
      sql`${table.reference} ~ '^AA-[0-9A-F]{12}$'`,
    ),
    check(
      "order_owner_check",
      sql`(${table.customerId} is not null and ${table.guestCartHash} is null and ${table.guestAccessTokenHash} is null and ${table.guestAccessExpiresAt} is null) or (${table.customerId} is null and ${table.guestCartHash} is not null and ${table.guestCartHash} ~ '^[0-9a-f]{64}$' and ${table.guestAccessTokenHash} is not null and ${table.guestAccessTokenHash} ~ '^[0-9a-f]{64}$' and ${table.guestAccessExpiresAt} is not null and ${table.guestAccessExpiresAt} = ${table.createdAt} + interval '30 days')`,
    ),
    check(
      "order_guest_token_hash_check",
      sql`${table.guestAccessTokenHash} is null or ${table.guestAccessTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "order_cart_revision_check",
      sql`${table.cartRevision} between 0 and 9007199254740991`,
    ),
    check(
      "order_status_check",
      sql`${table.status} in ('awaiting_confirmation', 'confirmed', 'rejected', 'cancelled')`,
    ),
    check(
      "order_serviceability_check",
      sql`${table.serviceability} in ('pending_manual_review', 'serviceable', 'unserviceable')`,
    ),
    check(
      "order_initial_state_check",
      sql`(${table.status} <> 'awaiting_confirmation' or (${table.serviceability} = 'pending_manual_review' and ${table.fulfillmentStatus} = 'not_started')) and (${table.status} <> 'confirmed' or (${table.serviceability} = 'serviceable' and ${table.fulfillmentStatus} = 'awaiting_dispatch' and ${table.cancellationReason} is null and ${table.cancelledAt} is null)) and (${table.status} <> 'rejected' or (${table.serviceability} = 'unserviceable' and ${table.fulfillmentStatus} = 'cancelled' and ${table.cancellationReason} is null and ${table.cancelledAt} is null)) and (${table.status} <> 'cancelled' or (${table.serviceability} = 'pending_manual_review' and ${table.fulfillmentStatus} = 'cancelled' and ${table.cancellationReason} = 'serviceability_review_timeout' and ${table.cancelledAt} is not null and ${table.cancelledAt} >= ${table.createdAt})) and ((${table.status} = 'cancelled' and ${table.cancellationReason} is not null and ${table.cancelledAt} is not null) or (${table.status} <> 'cancelled' and ${table.cancellationReason} is null and ${table.cancelledAt} is null))`,
    ),
    check("order_cod_method_check", sql`${table.paymentMethod} = 'cod'`),
    check(
      "order_collection_status_check",
      sql`${table.collectionStatus} = 'uncollected'`,
    ),
    check(
      "order_amount_check",
      sql`${table.merchandiseGrossBdt} between 0 and 9007199254740991 and ${table.deliveryAmountBdt} between 1 and 9007199254740991 and ${table.totalBdt} between 1 and 9007199254740991 and ${table.codAmountDueBdt} = ${table.totalBdt} and ${table.totalBdt} = ${table.merchandiseGrossBdt} + ${table.deliveryAmountBdt}`,
    ),
    check(
      "order_snapshot_object_check",
      sql`jsonb_typeof(${table.taxSnapshot}) = 'object' and jsonb_typeof(${table.deliverySnapshot}) = 'object'`,
    ),
    check(
      "order_address_ciphertext_check",
      sql`${table.addressCiphertext} like 'v1.%'`,
    ),
  ],
);

export const customerOrderLine = ordersSchema.table(
  "order_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceBdt: bigint("unit_price_bdt", { mode: "number" }).notNull(),
    grossAmountBdt: bigint("gross_amount_bdt", { mode: "number" }).notNull(),
    productSnapshot: jsonb("product_snapshot").notNull(),
  },
  (table) => [
    uniqueIndex("order_line_order_variant_uidx").on(
      table.orderId,
      table.variantId,
    ),
    index("order_line_variant_idx").on(table.variantId),
    check("order_line_quantity_check", sql`${table.quantity} between 1 and 10`),
    check(
      "order_line_amount_check",
      sql`${table.unitPriceBdt} between 0 and 9007199254740991 and ${table.grossAmountBdt} between 0 and 9007199254740991 and ${table.grossAmountBdt} = ${table.unitPriceBdt} * ${table.quantity}`,
    ),
    check(
      "order_line_snapshot_object_check",
      sql`jsonb_typeof(${table.productSnapshot}) = 'object'`,
    ),
  ],
);

export const orderIdempotency = ordersSchema.table(
  "idempotency",
  {
    ownerHash: text("owner_hash").notNull(),
    keyHash: text("key_hash").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_idempotency_owner_key_uidx").on(
      table.ownerHash,
      table.keyHash,
    ),
    uniqueIndex("order_idempotency_order_uidx").on(table.orderId),
    check(
      "order_idempotency_owner_hash_check",
      sql`${table.ownerHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "order_idempotency_key_hash_check",
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "order_idempotency_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
