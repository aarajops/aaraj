import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    addressCiphertext: text("address_ciphertext").notNull(),
    smsUpdatesConsent: boolean("sms_updates_consent").notNull().default(false),
    addressNamePrefixes: text("address_name_prefixes").array().notNull(),
    addressPhonePrefixes: text("address_phone_prefixes").array().notNull(),
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
    index("order_address_name_prefix_idx").using(
      "gin",
      table.addressNamePrefixes,
    ),
    index("order_address_phone_prefix_idx").using(
      "gin",
      table.addressPhonePrefixes,
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
      sql`${table.merchandiseGrossBdt} between 0 and 9007199254740991 and ${table.deliveryAmountBdt} between 1 and 9007199254740991 and ${table.totalBdt} between 1 and 9007199254740991 and ${table.codAmountDueBdt} = ${table.totalBdt} and ${table.totalBdt} = ${table.merchandiseGrossBdt} + ${table.deliveryAmountBdt}`,
    ),
    check(
      "order_snapshot_object_check",
      sql`jsonb_typeof(${table.deliverySnapshot}) = 'object'`,
    ),
    check(
      "order_address_ciphertext_check",
      sql`${table.addressCiphertext} ~ '^v2\\.[A-Za-z0-9_-]{1,32}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22}$' and length(${table.addressCiphertext}) between 46 and 8192`,
    ),
    check(
      "order_address_name_prefixes_check",
      sql`cardinality(${table.addressNamePrefixes}) between 1 and 120 and array_to_string(${table.addressNamePrefixes}, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'`,
    ),
    check(
      "order_address_phone_prefixes_check",
      sql`cardinality(${table.addressPhonePrefixes}) = 13 and array_to_string(${table.addressPhonePrefixes}, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'`,
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

export const orderReceiptCounter = ordersSchema.table(
  "order_receipt_counter",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull(),
  },
  (table) => [
    check(
      "order_receipt_counter_year_check",
      sql`${table.year} between 1 and 9999`,
    ),
    check(
      "order_receipt_counter_number_check",
      sql`${table.lastNumber} between 1 and 999999`,
    ),
  ],
);

export const orderReceipt = ordersSchema.table(
  "order_receipt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    receiptNumber: text("receipt_number").notNull(),
    sequenceYear: integer("sequence_year").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_receipt_order_uidx").on(table.orderId),
    uniqueIndex("order_receipt_number_uidx").on(table.receiptNumber),
    uniqueIndex("order_receipt_sequence_uidx").on(
      table.sequenceYear,
      table.sequenceNumber,
    ),
    index("order_receipt_issued_idx").on(table.issuedAt, table.id),
    check(
      "order_receipt_number_check",
      sql`${table.receiptNumber} ~ '^AAR-[0-9]{4}-[0-9]{6}$'`,
    ),
    check(
      "order_receipt_year_check",
      sql`${table.sequenceYear} between 1 and 9999`,
    ),
    check(
      "order_receipt_sequence_check",
      sql`${table.sequenceNumber} between 1 and 999999`,
    ),
    check(
      "order_receipt_snapshot_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
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

export const orderDeliveryLine = ordersSchema.table(
  "order_delivery_line",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => customerOrderLine.id, { onDelete: "restrict" }),
    quantityOrdered: integer("quantity_ordered").notNull(),
    quantityDelivered: integer("quantity_delivered").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_delivery_line_line_uidx").on(table.orderLineId),
    index("order_delivery_line_order_idx").on(table.orderId, table.orderLineId),
    check(
      "order_delivery_line_quantity_check",
      sql`${table.quantityOrdered} between 1 and 10 and ${table.quantityDelivered} between 0 and ${table.quantityOrdered}`,
    ),
  ],
);

export const orderReturnCase = ordersSchema.table(
  "order_return_case",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    origin: text("origin")
      .$type<"customer_return" | "courier_rts" | "doorstep_refusal">()
      .notNull(),
    status: text("status")
      .$type<
        | "requested"
        | "authorized"
        | "rejected"
        | "received"
        | "inspected"
        | "refund_pending"
        | "refunded"
        | "closed"
      >()
      .notNull(),
    reason: text("reason").notNull(),
    decisionReason: text("decision_reason"),
    receiptReason: text("receipt_reason"),
    maximumRefundAmountBdt: bigint("maximum_refund_amount_bdt", {
      mode: "number",
    })
      .notNull()
      .default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    decisionCommandId: uuid("decision_command_id"),
    decisionFingerprint: text("decision_fingerprint"),
    receivedCommandId: uuid("received_command_id"),
    receivedFingerprint: text("received_fingerprint"),
    inspectionCommandId: uuid("inspection_command_id"),
    inspectionFingerprint: text("inspection_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_return_case_command_uidx").on(table.commandId),
    uniqueIndex("order_return_case_decision_command_uidx").on(
      table.decisionCommandId,
    ),
    uniqueIndex("order_return_case_received_command_uidx").on(
      table.receivedCommandId,
    ),
    uniqueIndex("order_return_case_inspection_command_uidx").on(
      table.inspectionCommandId,
    ),
    index("order_return_case_order_created_idx").on(
      table.orderId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "order_return_case_origin_check",
      sql`${table.origin} in ('customer_return', 'courier_rts', 'doorstep_refusal')`,
    ),
    check(
      "order_return_case_status_check",
      sql`${table.status} in ('requested', 'authorized', 'rejected', 'received', 'inspected', 'refund_pending', 'refunded', 'closed')`,
    ),
    check(
      "order_return_case_reason_check",
      sql`${table.reason} = btrim(${table.reason}) and length(${table.reason}) between 3 and 500`,
    ),
    check(
      "order_return_case_refund_check",
      sql`${table.maximumRefundAmountBdt} between 0 and 9007199254740991`,
    ),
    check(
      "order_return_case_request_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "order_return_case_decision_pair_check",
      sql`(${table.decisionCommandId} is null and ${table.decisionFingerprint} is null) or (${table.decisionCommandId} is not null and ${table.decisionFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "order_return_case_received_pair_check",
      sql`(${table.receivedCommandId} is null and ${table.receivedFingerprint} is null) or (${table.receivedCommandId} is not null and ${table.receivedFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "order_return_case_inspection_pair_check",
      sql`(${table.inspectionCommandId} is null and ${table.inspectionFingerprint} is null) or (${table.inspectionCommandId} is not null and ${table.inspectionFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);

export const orderReturnCaseLine = ordersSchema.table(
  "order_return_case_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnCaseId: uuid("return_case_id")
      .notNull()
      .references(() => orderReturnCase.id, { onDelete: "restrict" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => customerOrderLine.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull(),
    productSnapshot: jsonb("product_snapshot").notNull(),
    requestedQuantity: integer("requested_quantity").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    unitPriceBdt: bigint("unit_price_bdt", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("order_return_case_line_case_order_line_uidx").on(
      table.returnCaseId,
      table.orderLineId,
    ),
    index("order_return_case_line_order_line_idx").on(table.orderLineId),
    check(
      "order_return_case_line_quantity_check",
      sql`${table.requestedQuantity} between 1 and 10 and ${table.receivedQuantity} between 0 and ${table.requestedQuantity}`,
    ),
    check(
      "order_return_case_line_money_check",
      sql`${table.unitPriceBdt} between 0 and 9007199254740991`,
    ),
    check(
      "order_return_case_line_product_snapshot_check",
      sql`jsonb_typeof(${table.productSnapshot}) = 'object'`,
    ),
  ],
);

export const orderReturnInspection = ordersSchema.table(
  "order_return_inspection",
  {
    returnLineId: uuid("return_line_id")
      .notNull()
      .references(() => orderReturnCaseLine.id, { onDelete: "restrict" }),
    grade: text("grade")
      .$type<"sellable" | "repairable" | "damaged" | "fraud_review">()
      .notNull(),
    quantity: integer("quantity").notNull(),
    commandId: uuid("command_id").notNull(),
    inspectedBy: text("inspected_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    inspectedAt: timestamp("inspected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "order_return_inspection_pk",
      columns: [table.returnLineId, table.grade],
    }),
    uniqueIndex("order_return_inspection_command_uidx").on(table.commandId),
    check(
      "order_return_inspection_grade_check",
      sql`${table.grade} in ('sellable', 'repairable', 'damaged', 'fraud_review')`,
    ),
    check("order_return_inspection_quantity_check", sql`${table.quantity} > 0`),
    check(
      "order_return_inspection_reason_check",
      sql`${table.reason} = btrim(${table.reason}) and length(${table.reason}) between 3 and 500`,
    ),
  ],
);

export const orderReturnRefund = ordersSchema.table(
  "order_return_refund",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnCaseId: uuid("return_case_id")
      .notNull()
      .references(() => orderReturnCase.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    amountBdt: bigint("amount_bdt", { mode: "number" }).notNull(),
    method: text("method")
      .$type<"bank_transfer" | "mobile_money" | "cash">()
      .notNull(),
    reference: text("reference"),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_return_refund_case_uidx").on(table.returnCaseId),
    uniqueIndex("order_return_refund_command_uidx").on(table.commandId),
    check(
      "order_return_refund_amount_check",
      sql`${table.amountBdt} between 0 and 9007199254740991`,
    ),
    check(
      "order_return_refund_method_check",
      sql`${table.method} in ('bank_transfer', 'mobile_money', 'cash')`,
    ),
    check(
      "order_return_refund_reference_check",
      sql`(${table.amountBdt} = 0 and ${table.reference} is null) or (${table.amountBdt} > 0 and ${table.reference} is not null and ${table.reference} = btrim(${table.reference}) and length(${table.reference}) between 1 and 160)`,
    ),
    check(
      "order_return_refund_reason_check",
      sql`${table.reason} = btrim(${table.reason}) and length(${table.reason}) between 3 and 500`,
    ),
  ],
);

export const courierRemittanceBatch = ordersSchema.table(
  "courier_remittance_batch",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").$type<"pathao">().notNull(),
    merchantAccountRef: text("merchant_account_ref").notNull(),
    providerRemittanceRef: text("provider_remittance_ref").notNull(),
    statementSha256: text("statement_sha256").notNull(),
    statementTotalBdt: bigint("statement_total_bdt", {
      mode: "number",
    }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"open" | "reconciled">().notNull(),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reconciliationCommandId: uuid("reconciliation_command_id"),
    reconciliationFingerprint: text("reconciliation_fingerprint"),
    reconciliationReason: text("reconciliation_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reconciledBy: text("reconciled_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("courier_remittance_batch_reference_uidx").on(
      table.provider,
      table.merchantAccountRef,
      table.providerRemittanceRef,
    ),
    uniqueIndex("courier_remittance_batch_hash_uidx").on(
      table.provider,
      table.merchantAccountRef,
      table.statementSha256,
    ),
    uniqueIndex("courier_remittance_batch_command_uidx").on(table.commandId),
    uniqueIndex("courier_remittance_batch_reconcile_command_uidx").on(
      table.reconciliationCommandId,
    ),
    index("courier_remittance_batch_created_idx").on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "courier_remittance_provider_check",
      sql`${table.provider} = 'pathao'`,
    ),
    check(
      "courier_remittance_account_ref_check",
      sql`${table.merchantAccountRef} = btrim(${table.merchantAccountRef}) and length(${table.merchantAccountRef}) between 1 and 120`,
    ),
    check(
      "courier_remittance_provider_ref_check",
      sql`${table.providerRemittanceRef} = btrim(${table.providerRemittanceRef}) and length(${table.providerRemittanceRef}) between 1 and 160`,
    ),
    check(
      "courier_remittance_hash_check",
      sql`${table.statementSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "courier_remittance_amount_check",
      sql`${table.statementTotalBdt} between 0 and 9007199254740991`,
    ),
    check(
      "courier_remittance_status_check",
      sql`${table.status} in ('open', 'reconciled')`,
    ),
    check(
      "courier_remittance_request_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "courier_remittance_reconciliation_pair_check",
      sql`(${table.reconciliationCommandId} is null and ${table.reconciliationFingerprint} is null and ${table.reconciliationReason} is null and ${table.reconciledBy} is null and ${table.reconciledAt} is null) or (${table.reconciliationCommandId} is not null and ${table.reconciliationFingerprint} ~ '^[0-9a-f]{64}$' and ${table.reconciliationReason} is not null and ${table.reconciledBy} is not null and ${table.reconciledAt} is not null)`,
    ),
  ],
);

export const courierRemittanceLine = ordersSchema.table(
  "courier_remittance_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => courierRemittanceBatch.id, { onDelete: "restrict" }),
    lineNumber: integer("line_number").notNull(),
    consignmentRef: text("consignment_ref").notNull(),
    orderId: uuid("order_id").references(() => customerOrder.id, {
      onDelete: "restrict",
    }),
    expectedCollectedAmountBdt: bigint("expected_collected_amount_bdt", {
      mode: "number",
    }),
    collectedAmountBdt: bigint("collected_amount_bdt", {
      mode: "number",
    }).notNull(),
    feeAmountBdt: bigint("fee_amount_bdt", { mode: "number" }).notNull(),
    netAmountBdt: bigint("net_amount_bdt", { mode: "number" }).notNull(),
    resolutionStatus: text("resolution_status")
      .$type<"matched" | "pending" | "external">()
      .notNull()
      .default("matched"),
    resolutionReason: text("resolution_reason"),
    resolutionCommandId: uuid("resolution_command_id"),
    resolutionFingerprint: text("resolution_fingerprint"),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("courier_remittance_line_number_uidx").on(
      table.batchId,
      table.lineNumber,
    ),
    uniqueIndex("courier_remittance_line_consignment_uidx").on(
      table.batchId,
      table.consignmentRef,
    ),
    uniqueIndex("courier_remittance_line_resolution_command_uidx").on(
      table.resolutionCommandId,
    ),
    index("courier_remittance_line_order_idx").on(table.orderId),
    check("courier_remittance_line_number_check", sql`${table.lineNumber} > 0`),
    check(
      "courier_remittance_line_consignment_check",
      sql`${table.consignmentRef} = btrim(${table.consignmentRef}) and length(${table.consignmentRef}) between 1 and 120`,
    ),
    check(
      "courier_remittance_line_amount_check",
      sql`${table.collectedAmountBdt} between 0 and 9007199254740991 and ${table.feeAmountBdt} between 0 and 9007199254740991 and ${table.netAmountBdt} between 0 and 9007199254740991 and ${table.netAmountBdt} = ${table.collectedAmountBdt} - ${table.feeAmountBdt}`,
    ),
    check(
      "courier_remittance_line_expected_check",
      sql`${table.expectedCollectedAmountBdt} is null or ${table.expectedCollectedAmountBdt} between 0 and 9007199254740991`,
    ),
    check(
      "courier_remittance_line_resolution_check",
      sql`(${table.resolutionStatus} = 'matched' and ${table.resolutionReason} is null and ${table.resolutionCommandId} is null and ${table.resolutionFingerprint} is null and ${table.resolvedBy} is null and ${table.resolvedAt} is null) or (${table.resolutionStatus} = 'pending' and ${table.orderId} is null and ${table.resolutionReason} is null and ${table.resolutionCommandId} is null and ${table.resolutionFingerprint} is null and ${table.resolvedBy} is null and ${table.resolvedAt} is null) or (${table.resolutionStatus} = 'external' and ${table.orderId} is null and ${table.resolutionReason} is not null and ${table.resolutionCommandId} is not null and ${table.resolutionFingerprint} ~ '^[0-9a-f]{64}$' and ${table.resolvedBy} is not null and ${table.resolvedAt} is not null)`,
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

export const orderNotificationOutbox = ordersSchema.table(
  "order_notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    eventKey: text("event_key").notNull(),
    channel: text("channel").$type<"sms">().notNull().default("sms"),
    status: text("status")
      .$type<
        | "pending"
        | "sending"
        | "unknown"
        | "accepted"
        | "delivered"
        | "failed"
        | "suppressed"
      >()
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    providerMessageSid: text("provider_message_sid"),
    providerStatus: text("provider_status"),
    lastErrorCode: text("last_error_code"),
    resolutionCommandId: uuid("resolution_command_id"),
    resolutionFingerprint: text("resolution_fingerprint"),
    resolutionReason: text("resolution_reason"),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_notification_event_uidx").on(
      table.orderId,
      table.eventKey,
      table.channel,
    ),
    uniqueIndex("order_notification_provider_sid_uidx").on(
      table.providerMessageSid,
    ),
    uniqueIndex("order_notification_resolution_command_uidx").on(
      table.resolutionCommandId,
    ),
    index("order_notification_queue_idx")
      .on(table.availableAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index("order_notification_exception_idx")
      .on(table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.status} in ('unknown', 'failed')`),
    check(
      "order_notification_event_check",
      sql`${table.eventKey} in ('order_received', 'order_confirmed', 'order_cancelled', 'order_dispatched', 'order_partially_delivered', 'order_delivered', 'order_delivery_issue', 'order_returned')`,
    ),
    check("order_notification_channel_check", sql`${table.channel} = 'sms'`),
    check(
      "order_notification_status_check",
      sql`${table.status} in ('pending', 'sending', 'unknown', 'accepted', 'delivered', 'failed', 'suppressed')`,
    ),
    check("order_notification_attempt_check", sql`${table.attemptCount} >= 0`),
    check(
      "order_notification_provider_sid_check",
      sql`${table.providerMessageSid} is null or ${table.providerMessageSid} ~ '^SM[0-9a-fA-F]{32}$'`,
    ),
    check(
      "order_notification_error_check",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^[A-Z0-9_]{1,80}$'`,
    ),
    check(
      "order_notification_resolution_pair_check",
      sql`(${table.resolutionCommandId} is null and ${table.resolutionFingerprint} is null and ${table.resolutionReason} is null and ${table.resolvedBy} is null and ${table.resolvedAt} is null) or (${table.resolutionCommandId} is not null and ${table.resolutionFingerprint} ~ '^[0-9a-f]{64}$' and ${table.resolutionReason} is not null and ${table.resolvedBy} is not null and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const orderNotificationConsentRevocation = ordersSchema.table(
  "order_notification_consent_revocation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "restrict" }),
    revokedBy: text("revoked_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("order_notification_consent_revocation_order_uidx").on(
      table.orderId,
    ),
    index("order_notification_consent_revocation_time_idx").on(
      table.revokedAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const courierSettlementJournal = ordersSchema.table(
  "courier_settlement_journal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => courierRemittanceBatch.id, { onDelete: "restrict" }),
    confirmationId: uuid("confirmation_id").notNull(),
    status: text("status")
      .$type<"draft" | "posted">()
      .notNull()
      .default("draft"),
    postedBy: text("posted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    bankReference: text("bank_reference").notNull(),
    bankAmountBdt: bigint("bank_amount_bdt", { mode: "number" }).notNull(),
    totalCollectedBdt: bigint("total_collected_bdt", {
      mode: "number",
    }).notNull(),
    totalFeesBdt: bigint("total_fees_bdt", { mode: "number" }).notNull(),
    totalNetBdt: bigint("total_net_bdt", { mode: "number" }).notNull(),
    varianceBdt: bigint("variance_bdt", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("courier_settlement_journal_batch_uidx").on(table.batchId),
    uniqueIndex("courier_settlement_journal_confirmation_uidx").on(
      table.confirmationId,
    ),
    index("courier_settlement_journal_posted_idx").on(
      table.postedAt.desc(),
      table.id.desc(),
    ),
    check(
      "courier_settlement_journal_status_check",
      sql`${table.status} in ('draft', 'posted')`,
    ),
    check(
      "courier_settlement_journal_amount_check",
      sql`${table.bankAmountBdt} between 0 and 9007199254740991 and ${table.totalCollectedBdt} between 0 and 9007199254740991 and ${table.totalFeesBdt} between 0 and 9007199254740991 and ${table.totalNetBdt} between 0 and 9007199254740991 and ${table.varianceBdt} between -9007199254740991 and 9007199254740991 and ${table.totalNetBdt} = ${table.totalCollectedBdt} - ${table.totalFeesBdt}`,
    ),
    check(
      "courier_settlement_journal_reference_check",
      sql`${table.bankReference} = btrim(${table.bankReference}) and length(${table.bankReference}) between 1 and 160`,
    ),
    check(
      "courier_settlement_journal_posted_pair_check",
      sql`(${table.status} = 'draft' and ${table.postedAt} is null) or (${table.status} = 'posted' and ${table.postedAt} is not null)`,
    ),
  ],
);

export const courierSettlementConfirmation = ordersSchema.table(
  "courier_settlement_confirmation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => courierRemittanceBatch.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    bankReference: text("bank_reference").notNull(),
    bankAmountBdt: bigint("bank_amount_bdt", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    confirmedBy: text("confirmed_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("courier_settlement_confirmation_batch_uidx").on(table.batchId),
    uniqueIndex("courier_settlement_confirmation_command_uidx").on(
      table.commandId,
    ),
    uniqueIndex("courier_settlement_confirmation_bank_reference_uidx").on(
      table.bankReference,
    ),
    check(
      "courier_settlement_confirmation_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "courier_settlement_confirmation_amount_check",
      sql`${table.bankAmountBdt} between 0 and 9007199254740991`,
    ),
    check(
      "courier_settlement_confirmation_reference_check",
      sql`${table.bankReference} = btrim(${table.bankReference}) and length(${table.bankReference}) between 1 and 160`,
    ),
    check(
      "courier_settlement_confirmation_reason_check",
      sql`${table.reason} = btrim(${table.reason}) and length(${table.reason}) between 3 and 500`,
    ),
  ],
);

export const courierSettlementJournalEntry = ordersSchema.table(
  "courier_settlement_journal_entry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => courierSettlementJournal.id, { onDelete: "restrict" }),
    lineNumber: integer("line_number").notNull(),
    accountKey: text("account_key")
      .$type<
        | "bank_cash"
        | "courier_fee_expense"
        | "cod_settlement_clearing"
        | "settlement_variance_suspense"
      >()
      .notNull(),
    debitBdt: bigint("debit_bdt", { mode: "number" }).notNull().default(0),
    creditBdt: bigint("credit_bdt", { mode: "number" }).notNull().default(0),
    memo: text("memo").notNull(),
    sourceLineId: uuid("source_line_id").references(
      () => courierRemittanceLine.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("courier_settlement_journal_entry_number_uidx").on(
      table.journalId,
      table.lineNumber,
    ),
    index("courier_settlement_journal_entry_account_idx").on(
      table.accountKey,
      table.journalId,
    ),
    check(
      "courier_settlement_journal_entry_line_check",
      sql`${table.lineNumber} > 0`,
    ),
    check(
      "courier_settlement_journal_entry_account_check",
      sql`${table.accountKey} in ('bank_cash', 'courier_fee_expense', 'cod_settlement_clearing', 'settlement_variance_suspense')`,
    ),
    check(
      "courier_settlement_journal_entry_amount_check",
      sql`${table.debitBdt} between 0 and 9007199254740991 and ${table.creditBdt} between 0 and 9007199254740991 and ((${table.debitBdt} > 0 and ${table.creditBdt} = 0) or (${table.creditBdt} > 0 and ${table.debitBdt} = 0))`,
    ),
    check(
      "courier_settlement_journal_entry_memo_check",
      sql`${table.memo} = btrim(${table.memo}) and length(${table.memo}) between 1 and 200`,
    ),
  ],
);
