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
import type { OrderAddressSnapshotEnvelope } from "./order-address-crypto.js";
import { user } from "../auth/auth-schema.js";
import { quoteSnapshot } from "../quote/quote-schema.js";
import { inventoryStockReservation } from "../inventory/inventory-schema.js";

export const ordersSchema = pgSchema("orders");

export const checkoutDraft = ordersSchema.table(
  "checkout_draft",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerHash: text("owner_hash").notNull(),
    customerId: text("customer_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    guestCartHash: text("guest_cart_hash"),
    guestCartIdCiphertext: text("guest_cart_id_ciphertext"),
    cartRevision: bigint("cart_revision", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    formCiphertext: text("form_ciphertext").notNull(),
    items: jsonb("items").notNull(),
    estimatedTotalBdt: bigint("estimated_total_bdt", { mode: "number" }),
    deliveryZone: text("delivery_zone"),
    destination: jsonb("destination"),
    outcome: text("outcome").notNull().default("new"),
    attemptCount: integer("attempt_count").notNull().default(0),
    callbackAt: timestamp("callback_at", { withTimezone: true }),
    lastCustomerActivityAt: timestamp("last_customer_activity_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("checkout_draft_owner_uidx").on(table.ownerHash),
    index("checkout_draft_activity_idx").on(
      table.lastCustomerActivityAt,
      table.id,
    ),
    check(
      "checkout_draft_owner_check",
      sql`(${table.customerId} is not null and ${table.guestCartHash} is null and ${table.guestCartIdCiphertext} is null) or (${table.customerId} is null and ${table.guestCartHash} ~ '^[0-9a-f]{64}$' and ${table.guestCartIdCiphertext} is not null)`,
    ),
    check(
      "checkout_draft_version_check",
      sql`${table.version} > 0 and ${table.cartRevision} between 0 and 9007199254740991`,
    ),
    check(
      "checkout_draft_outcome_check",
      sql`${table.outcome} in ('new','no_answer','interested','call_back','declined','do_not_contact')`,
    ),
    check(
      "checkout_draft_items_check",
      sql`jsonb_typeof(${table.items}) = 'array'`,
    ),
    check("checkout_draft_attempts_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const checkoutCallSuppression = ordersSchema.table(
  "checkout_call_suppression",
  {
    phoneHash: text("phone_hash").primaryKey(),
  },
);

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
    sourceDraftId: uuid("source_draft_id"),
    createdByStaffId: text("created_by_staff_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quoteSnapshot.id, { onDelete: "restrict" }),
    cartRevision: bigint("cart_revision", { mode: "number" }).notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => inventoryStockReservation.id, { onDelete: "restrict" }),
    addressSnapshot: jsonb("address_snapshot")
      .$type<OrderAddressSnapshotEnvelope>()
      .notNull(),
    addressSearchTokens: text("address_search_tokens").array().notNull(),
    status: text("status")
      .$type<"pending" | "no_answer" | "confirmed" | "on_hold" | "cancelled">()
      .notNull()
      .default("pending"),
    paymentMethod: text("payment_method").notNull().default("cod"),
    collectionStatus: text("collection_status")
      .$type<"uncollected" | "collected" | "discrepancy">()
      .notNull()
      .default("uncollected"),
    collectedAmountBdt: bigint("collected_amount_bdt", { mode: "number" }),
    collectionReason: text("collection_reason"),
    fulfillmentStatus: text("fulfillment_status")
      .$type<
        | "not_started"
        | "awaiting_dispatch"
        | "dispatched"
        | "partially_delivered"
        | "delivered"
        | "delivery_failed"
        | "returned"
        | "cancelled"
      >()
      .notNull(),
    dispatchCommandId: uuid("dispatch_command_id"),
    dispatchRequestFingerprint: text("dispatch_request_fingerprint"),
    deliveryProvider: text("delivery_provider").$type<"manual" | "pathao">(),
    deliveryOperator: text("delivery_operator"),
    handoffReference: text("handoff_reference"),
    dispatchedBy: text("dispatched_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    fulfillmentOutcomeReason: text("fulfillment_outcome_reason"),
    // The timeout value remains for Orders cancelled before migration 0047.
    cancellationReason: text("cancellation_reason").$type<"staff_cancelled">(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    merchandiseGrossBdt: bigint("merchandise_gross_bdt", {
      mode: "number",
    }).notNull(),
    manualDiscountBdt: bigint("manual_discount_bdt", { mode: "number" })
      .notNull()
      .default(0),
    deliveryAmountBdt: bigint("delivery_amount_bdt", {
      mode: "number",
    }).notNull(),
    totalBdt: bigint("total_bdt", { mode: "number" }).notNull(),
    codAmountDueBdt: bigint("cod_amount_due_bdt", { mode: "number" }).notNull(),
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
    uniqueIndex("order_source_draft_uidx").on(table.sourceDraftId),
    index("order_created_id_idx").on(table.createdAt.desc(), table.id.desc()),
    index("order_customer_created_idx").on(table.customerId, table.createdAt),
    index("order_status_created_idx").on(table.status, table.createdAt),
    index("order_address_search_tokens_gin_idx").using(
      "gin",
      table.addressSearchTokens,
    ),
    index("order_guest_cart_revision_idx")
      .on(table.guestCartHash, table.cartRevision)
      .where(sql`${table.guestCartHash} is not null`),
    uniqueIndex("order_dispatch_command_uidx").on(table.dispatchCommandId),
    check(
      "order_reference_check",
      sql`${table.reference} ~ '^(AA-[0-9A-F]{12}|ORD-[0-9]{3}-[0-9]{5})$'`,
    ),
    check(
      "order_owner_check",
      sql`(${table.customerId} is not null and ${table.guestCartHash} is null and ${table.guestAccessTokenHash} is null and ${table.guestAccessExpiresAt} is null) or (${table.customerId} is null and ${table.guestCartHash} is not null and ${table.guestCartHash} ~ '^[0-9a-f]{64}$' and ((${table.sourceDraftId} is not null and ${table.guestAccessTokenHash} is null and ${table.guestAccessExpiresAt} is null) or (${table.sourceDraftId} is null and ${table.guestAccessTokenHash} is not null and ${table.guestAccessTokenHash} ~ '^[0-9a-f]{64}$' and ${table.guestAccessExpiresAt} is not null and ${table.guestAccessExpiresAt} = ${table.createdAt} + interval '30 days')))`,
    ),
    check(
      "order_staff_source_check",
      sql`(${table.sourceDraftId} is null and ${table.createdByStaffId} is null) or (${table.sourceDraftId} is not null and ${table.createdByStaffId} is not null)`,
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
      sql`${table.status} in ('pending', 'no_answer', 'confirmed', 'on_hold', 'cancelled')`,
    ),
    check(
      "order_initial_state_check",
      sql`(${table.status} <> 'pending' or ${table.fulfillmentStatus} = 'not_started')
        and (${table.status} <> 'no_answer' or ${table.fulfillmentStatus} = 'not_started')
        and (${table.status} <> 'on_hold' or ${table.fulfillmentStatus} in ('not_started', 'awaiting_dispatch'))
        and (${table.status} <> 'confirmed' or (${table.fulfillmentStatus} in ('awaiting_dispatch', 'dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.cancellationReason} is null and ${table.cancelledAt} is null))
        and (${table.status} <> 'cancelled' or (${table.fulfillmentStatus} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancelledAt} >= ${table.createdAt} and ${table.cancellationReason} = 'staff_cancelled'))
        and ((${table.status} = 'cancelled' and ${table.cancellationReason} is not null and ${table.cancelledAt} is not null) or (${table.status} <> 'cancelled' and ${table.cancellationReason} is null and ${table.cancelledAt} is null))
        and ((${table.fulfillmentStatus} in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.dispatchCommandId} is not null and ${table.dispatchRequestFingerprint} is not null and ${table.dispatchRequestFingerprint} ~ '^[0-9a-f]{64}$' and ${table.deliveryOperator} is not null and ${table.deliveryOperator} = btrim(${table.deliveryOperator}) and length(${table.deliveryOperator}) between 2 and 120 and ${table.dispatchedBy} is not null and ${table.dispatchedAt} is not null) or (${table.fulfillmentStatus} not in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.dispatchCommandId} is null and ${table.dispatchRequestFingerprint} is null and ${table.deliveryOperator} is null and ${table.handoffReference} is null and ${table.dispatchedBy} is null and ${table.dispatchedAt} is null))
        and ((${table.fulfillmentStatus} in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.fulfillmentOutcomeReason} is not null and ${table.fulfillmentOutcomeReason} = btrim(${table.fulfillmentOutcomeReason}) and length(${table.fulfillmentOutcomeReason}) between 3 and 500) or (${table.fulfillmentStatus} not in ('partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.fulfillmentOutcomeReason} is null))
        and (${table.handoffReference} is null or (${table.handoffReference} = btrim(${table.handoffReference}) and length(${table.handoffReference}) between 1 and 160))`,
    ),
    check(
      "order_delivery_provider_check",
      sql`(${table.fulfillmentStatus} in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and (${table.deliveryProvider} is null or ${table.deliveryProvider} in ('manual', 'pathao'))) or (${table.fulfillmentStatus} not in ('dispatched', 'partially_delivered', 'delivered', 'delivery_failed', 'returned') and ${table.deliveryProvider} is null)`,
    ),
    check(
      "order_collection_status_check",
      sql`(${table.collectionStatus} = 'uncollected' and ${table.collectedAmountBdt} is null and ${table.collectionReason} is null) or (${table.collectionStatus} in ('collected', 'discrepancy') and ${table.collectedAmountBdt} is not null and ${table.collectedAmountBdt} between 0 and 9007199254740991 and ${table.collectionReason} is not null and ${table.collectionReason} = btrim(${table.collectionReason}) and length(${table.collectionReason}) between 3 and 500)`,
    ),
    check(
      "order_collection_amount_status_check",
      sql`(${table.collectionStatus} = 'collected' and ${table.collectedAmountBdt} is not null and ${table.collectedAmountBdt} = ${table.codAmountDueBdt}) or (${table.collectionStatus} = 'discrepancy' and ${table.collectedAmountBdt} is not null and ${table.collectedAmountBdt} <> ${table.codAmountDueBdt}) or ${table.collectionStatus} = 'uncollected'`,
    ),
    check("order_cod_method_check", sql`${table.paymentMethod} = 'cod'`),
    check(
      "order_amount_check",
      sql`${table.merchandiseGrossBdt} between 0 and 9007199254740991 and ${table.manualDiscountBdt} between 0 and ${table.merchandiseGrossBdt} and ${table.deliveryAmountBdt} between 1 and 9007199254740991 and ${table.totalBdt} between 1 and 9007199254740991 and ${table.codAmountDueBdt} = ${table.totalBdt} and ${table.totalBdt} = ${table.merchandiseGrossBdt} + ${table.deliveryAmountBdt} - ${table.manualDiscountBdt}`,
    ),
    check(
      "order_snapshot_object_check",
      sql`jsonb_typeof(${table.deliverySnapshot}) = 'object'`,
    ),
    check(
      "order_address_snapshot_check",
      sql`jsonb_typeof(${table.addressSnapshot}) = 'object'`,
    ),
    check(
      "order_address_search_tokens_check",
      sql`cardinality(${table.addressSearchTokens}) > 0`,
    ),
  ],
);

export const orderReferenceCounter = ordersSchema.table(
  "order_reference_counter",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull(),
  },
  (table) => [
    check(
      "order_reference_counter_year_check",
      sql`${table.year} between 1 and 9999`,
    ),
    check(
      "order_reference_counter_number_check",
      sql`${table.lastNumber} between 1 and 99999`,
    ),
  ],
);

export const orderPathaoBookingClaim = ordersSchema.table(
  "pathao_booking_claim",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    status: text("status")
      .$type<
        "submitting" | "booked" | "outcome_unknown" | "reconciliation_required"
      >()
      .notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_pathao_booking_claim_command_uidx").on(table.commandId),
    index("order_pathao_booking_claim_stale_idx")
      .on(table.createdAt, table.orderId)
      .where(sql`${table.status} = 'submitting'`),
    check(
      "order_pathao_booking_claim_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "order_pathao_booking_claim_status_check",
      sql`${table.status} in ('submitting', 'booked', 'outcome_unknown', 'reconciliation_required')`,
    ),
    check(
      "order_pathao_booking_claim_error_check",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^PATHAO_[A-Z0-9_]+$'`,
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
