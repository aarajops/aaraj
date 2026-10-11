import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../../auth/auth-schema.js";
import { deliverySchema } from "../delivery-schema.js";

export const pathaoApiToken = deliverySchema.table(
  "pathao_api_token",
  {
    environment: text("environment").primaryKey(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    refreshLeaseOwner: uuid("refresh_lease_owner"),
    refreshLeaseExpiresAt: timestamp("refresh_lease_expires_at", {
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "pathao_api_token_environment_check",
      sql`${table.environment} in ('sandbox', 'live')`,
    ),
    check(
      "pathao_api_token_pair_check",
      sql`(${table.accessTokenCiphertext} is null and ${table.refreshTokenCiphertext} is null and ${table.accessExpiresAt} is null) or (${table.accessTokenCiphertext} is not null and ${table.refreshTokenCiphertext} is not null and ${table.accessExpiresAt} is not null)`,
    ),
    check(
      "pathao_api_token_lease_pair_check",
      sql`(${table.refreshLeaseOwner} is null and ${table.refreshLeaseExpiresAt} is null) or (${table.refreshLeaseOwner} is not null and ${table.refreshLeaseExpiresAt} is not null)`,
    ),
  ],
);

export const pathaoBooking = deliverySchema.table(
  "pathao_booking",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    source: text("source").notNull().default("api"),
    environment: text("environment").notNull(),
    storeId: integer("store_id").notNull(),
    deliveryType: integer("delivery_type").notNull(),
    parcelQuantity: integer("parcel_quantity").notNull(),
    parcelWeightKg: numeric("parcel_weight_kg", { mode: "number" }).notNull(),
    merchantOrderId: text("merchant_order_id").notNull(),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reconciliationCommandId: uuid("reconciliation_command_id"),
    reconciliationFingerprint: text("reconciliation_fingerprint"),
    reconciliationReason: text("reconciliation_reason"),
    reconciledBy: text("reconciled_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    status: text("status").notNull(),
    consignmentId: text("consignment_id"),
    providerOrderStatus: text("provider_order_status"),
    deliveryFeeBdt: numeric("delivery_fee_bdt", { mode: "number" }),
    trackingProgress: text("tracking_progress").notNull().default("booked"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pathao_booking_order_uidx").on(table.orderId),
    uniqueIndex("pathao_booking_command_uidx").on(table.commandId),
    uniqueIndex("pathao_booking_reconciliation_command_uidx").on(
      table.reconciliationCommandId,
    ),
    uniqueIndex("pathao_booking_merchant_reference_uidx").on(
      table.environment,
      table.merchantOrderId,
    ),
    uniqueIndex("pathao_booking_consignment_uidx").on(
      table.environment,
      table.consignmentId,
    ),
    index("pathao_booking_created_idx").on(table.createdAt, table.id),
    check(
      "pathao_booking_environment_check",
      sql`${table.environment} in ('sandbox', 'live')`,
    ),
    check(
      "pathao_booking_source_check",
      sql`${table.source} in ('api', 'manual')`,
    ),
    check(
      "pathao_booking_delivery_type_check",
      sql`${table.deliveryType} in (12, 48)`,
    ),
    check(
      "pathao_booking_parcel_quantity_check",
      sql`${table.parcelQuantity} > 0`,
    ),
    check(
      "pathao_booking_weight_check",
      sql`${table.parcelWeightKg} between 0.5 and 10`,
    ),
    check(
      "pathao_booking_reference_check",
      sql`${table.merchantOrderId} ~ '^AA-[0-9A-F]{12}$'`,
    ),
    check(
      "pathao_booking_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "pathao_booking_reconciliation_pair_check",
      sql`(${table.reconciliationCommandId} is null and ${table.reconciliationFingerprint} is null and ${table.reconciliationReason} is null and ${table.reconciledBy} is null and ${table.reconciledAt} is null) or (${table.reconciliationCommandId} is not null and ${table.reconciliationFingerprint} is not null and ${table.reconciliationFingerprint} ~ '^[0-9a-f]{64}$' and ${table.reconciliationReason} is not null and length(${table.reconciliationReason}) between 3 and 500 and ${table.reconciledBy} is not null and ${table.reconciledAt} is not null)`,
    ),
    check(
      "pathao_booking_reconciliation_fingerprint_check",
      sql`${table.reconciliationFingerprint} is null or ${table.reconciliationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "pathao_booking_last_error_code_check",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^PATHAO_[A-Z0-9_]+$'`,
    ),
    check(
      "pathao_booking_status_check",
      sql`${table.status} in ('submitting', 'booked', 'outcome_unknown', 'reconciliation_required')`,
    ),
    check(
      "pathao_booking_result_check",
      sql`(${table.status} = 'booked' and ${table.consignmentId} is not null) or (${table.status} <> 'booked' and ${table.consignmentId} is null)`,
    ),
    check(
      "pathao_booking_delivery_fee_check",
      sql`${table.deliveryFeeBdt} is null or ${table.deliveryFeeBdt} >= 0`,
    ),
    check(
      "pathao_booking_tracking_progress_check",
      sql`${table.trackingProgress} in ('booked', 'pickup', 'in_transit', 'out_for_delivery', 'delivered', 'partial_delivery', 'delivery_failed', 'returning', 'returned', 'on_hold', 'reconciliation_required')`,
    ),
  ],
);

export const pathaoWebhookInbox = deliverySchema.table(
  "pathao_webhook_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: text("environment").notNull(),
    eventName: text("event_name").notNull(),
    consignmentId: text("consignment_id"),
    merchantOrderId: text("merchant_order_id"),
    storeId: integer("store_id"),
    bookingId: uuid("booking_id").references(() => pathaoBooking.id, {
      onDelete: "restrict",
    }),
    eventFingerprint: text("event_fingerprint").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingState: text("processing_state").notNull().default("pending"),
    providerOrderStatus: text("provider_order_status"),
    providerCollectedAmountBdt: numeric("provider_collected_amount_bdt", {
      mode: "number",
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", {
      withTimezone: true,
    }),
    processingLeaseOwner: uuid("processing_lease_owner"),
    lastErrorCode: text("last_error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pathao_webhook_fingerprint_uidx").on(
      table.environment,
      table.eventFingerprint,
    ),
    index("pathao_webhook_pending_idx")
      .on(table.nextAttemptAt, table.receivedAt, table.id)
      .where(sql`${table.processingState} in ('pending', 'retry')`),
    index("pathao_webhook_booking_received_idx").on(
      table.bookingId,
      table.receivedAt,
    ),
    index("pathao_webhook_processing_lease_idx")
      .on(table.processingLeaseExpiresAt, table.id)
      .where(sql`${table.processingState} = 'processing'`),
    check(
      "pathao_webhook_environment_check",
      sql`${table.environment} in ('sandbox', 'live')`,
    ),
    check(
      "pathao_webhook_event_name_check",
      sql`length(${table.eventName}) between 1 and 80`,
    ),
    check(
      "pathao_webhook_fingerprint_check",
      sql`${table.eventFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "pathao_webhook_payload_object_check",
      sql`jsonb_typeof(${table.normalizedPayload}) = 'object'`,
    ),
    check(
      "pathao_webhook_processing_state_check",
      sql`${table.processingState} in ('pending', 'retry', 'processing', 'verified', 'reconciliation_required', 'unmatched', 'ignored')`,
    ),
    check(
      "pathao_webhook_processing_lease_pair_check",
      sql`(${table.processingState} = 'processing' and ${table.processingLeaseOwner} is not null and ${table.processingLeaseExpiresAt} is not null) or (${table.processingState} <> 'processing' and ${table.processingLeaseOwner} is null and ${table.processingLeaseExpiresAt} is null)`,
    ),
    check(
      "pathao_webhook_amount_check",
      sql`${table.providerCollectedAmountBdt} is null or ${table.providerCollectedAmountBdt} >= 0`,
    ),
  ],
);

export const pathaoWebhookResolution = deliverySchema.table(
  "pathao_webhook_resolution",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => pathaoWebhookInbox.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    action: text("action").notNull(),
    resultingState: text("resulting_state").notNull(),
    reason: text("reason").notNull(),
    verifiedInPathaoPanel: boolean("verified_in_pathao_panel")
      .notNull()
      .default(false),
    resolvedBy: text("resolved_by").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("pathao_webhook_resolution_command_uidx").on(table.commandId),
    index("pathao_webhook_resolution_event_idx").on(
      table.eventId,
      table.resolvedAt,
    ),
    check(
      "pathao_webhook_resolution_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "pathao_webhook_resolution_action_check",
      sql`(${table.action} = 'recheck' and ${table.resultingState} = 'pending' and ${table.verifiedInPathaoPanel} = false) or (${table.action} = 'acknowledge_no_change' and ${table.resultingState} = 'ignored' and ${table.verifiedInPathaoPanel} = true)`,
    ),
    check(
      "pathao_webhook_resolution_reason_check",
      sql`length(${table.reason}) between 3 and 500`,
    ),
  ],
);
