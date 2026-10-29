import { z } from "zod";
import {
  MAX_LIST_PAGE_SIZE,
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";
import { OrderReferenceSchema } from "../orders/order-reference.js";

export const PathaoDeliveryTypeSchema = z.union([z.literal(48), z.literal(12)]);
export type PathaoDeliveryType = z.infer<typeof PathaoDeliveryTypeSchema>;

export const PathaoStoreSchema = z.strictObject({
  storeId: z.number().int().positive().max(2_147_483_647),
  storeName: z.string().min(1).max(100),
  active: z.boolean(),
});

export const PathaoStoreListSchema = z.array(PathaoStoreSchema).max(1000);
export type PathaoStore = z.infer<typeof PathaoStoreSchema>;

export const PathaoBookingOptionsSchema = z.strictObject({
  stores: PathaoStoreListSchema,
});
export type PathaoBookingOptions = z.infer<typeof PathaoBookingOptionsSchema>;

export const PathaoBookingInputSchema = z.strictObject({
  storeId: z.number().int().positive().max(2_147_483_647),
  parcelQuantity: z.number().int().positive().max(2_147_483_647),
  parcelWeightKg: z.number().min(0.5).max(10),
});
export type PathaoBookingInput = z.infer<typeof PathaoBookingInputSchema>;

export const PathaoBookingStatusSchema = z.enum([
  "submitting",
  "booked",
  "outcome_unknown",
  "reconciliation_required",
]);

export const PathaoTrackingProgressSchema = z.enum([
  "booked",
  "pickup",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "partial_delivery",
  "delivery_failed",
  "returning",
  "returned",
  "on_hold",
  "reconciliation_required",
]);

export const PathaoBookingSchema = z.strictObject({
  orderId: z.uuid(),
  environment: z.enum(["sandbox", "live"]),
  source: z.enum(["api", "manual"]),
  storeId: z.number().int().positive().max(2_147_483_647),
  deliveryType: PathaoDeliveryTypeSchema.nullable(),
  parcelQuantity: z.number().int().positive().max(2_147_483_647),
  parcelWeightKg: z.number().min(0.5).max(10),
  merchantOrderId: z.string().min(1).max(100),
  status: PathaoBookingStatusSchema,
  consignmentId: z.string().min(1).max(120).nullable(),
  providerOrderStatus: z.string().max(100).nullable(),
  deliveryFeeBdt: z.number().nonnegative().nullable(),
  lastErrorCode: z
    .string()
    .regex(/^PATHAO_[A-Z0-9_]+$/)
    .max(80)
    .nullable(),
  reconciliationReason: z.string().min(3).max(500).nullable(),
  reconciledAt: z.iso.datetime().nullable(),
  trackingProgress: PathaoTrackingProgressSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PathaoBooking = z.infer<typeof PathaoBookingSchema>;

export const PathaoManagementBookingSummarySchema = z.strictObject({
  orderId: z.uuid(),
  status: PathaoBookingStatusSchema.nullable(),
  trackingProgress: PathaoTrackingProgressSchema.nullable(),
  consignmentId: z.string().min(1).max(120).nullable(),
  hasUnresolvedWebhookIssue: z.boolean(),
});
export type PathaoManagementBookingSummary = z.infer<
  typeof PathaoManagementBookingSummarySchema
>;

export const PathaoManagementBookingSummariesQuerySchema = z.strictObject({
  orderIds: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(z.uuid()).min(1).max(MAX_LIST_PAGE_SIZE))
    .refine((orderIds) => new Set(orderIds).size === orderIds.length),
});
export type PathaoManagementBookingSummariesQuery = z.infer<
  typeof PathaoManagementBookingSummariesQuerySchema
>;

export const PathaoManagementBookingSummariesSchema = z
  .array(PathaoManagementBookingSummarySchema)
  .max(MAX_LIST_PAGE_SIZE);

export const PathaoWebhookObservationSchema = z.strictObject({
  event: z.string().min(1).max(80),
  consignmentId: z.string().min(1).max(120).nullable(),
  status: z.enum([
    "pending",
    "retry",
    "processing",
    "verified",
    "reconciliation_required",
    "unmatched",
    "ignored",
  ]),
  providerStatus: z.string().max(100).nullable(),
  providerCollectedAmount: z.number().nonnegative().nullable(),
  providerTimestamp: z.iso.datetime().nullable(),
  receivedAt: z.iso.datetime(),
  errorCode: z
    .string()
    .regex(/^PATHAO_[A-Z0-9_]+$/)
    .max(80)
    .nullable(),
});
export type PathaoWebhookObservation = z.infer<
  typeof PathaoWebhookObservationSchema
>;

export const PathaoCustomerBookingSchema = z.strictObject({
  consignmentId: z.string().min(1).max(120),
  trackingProgress: PathaoTrackingProgressSchema,
  createdAt: z.iso.datetime(),
});

const PathaoCustomerObservationSchema = z.strictObject({
  event: z.string().min(1).max(80),
  providerTimestamp: z.iso.datetime().nullable(),
  receivedAt: z.iso.datetime(),
});

export const PathaoBookingManagementSchema = z.strictObject({
  booking: PathaoBookingSchema.nullable(),
  claimStatus: PathaoBookingStatusSchema.nullable(),
  observations: z.array(PathaoWebhookObservationSchema).max(100),
});
export type PathaoBookingManagement = z.infer<
  typeof PathaoBookingManagementSchema
>;

export const PathaoCustomerTrackingSchema = z.strictObject({
  booking: PathaoCustomerBookingSchema.nullable(),
  observations: z.array(PathaoCustomerObservationSchema).max(100),
});
export type PathaoCustomerTracking = z.infer<
  typeof PathaoCustomerTrackingSchema
>;

export const PathaoManualReconciliationInputSchema = z.strictObject({
  consignmentId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/),
  storeId: z.number().int().positive().max(2_147_483_647),
  parcelQuantity: z.number().int().positive().max(2_147_483_647),
  parcelWeightKg: z.number().min(0.5).max(10),
  reason: z.string().trim().min(3).max(500),
  verifiedInPathaoPanel: z.literal(true),
});
export type PathaoManualReconciliationInput = z.infer<
  typeof PathaoManualReconciliationInputSchema
>;

export const PathaoManagementIssueSchema = z.strictObject({
  id: z.uuid(),
  orderId: z.uuid().nullable(),
  orderReference: OrderReferenceSchema.nullable(),
  consignmentId: z.string().min(1).max(120).nullable(),
  merchantOrderId: z.string().min(1).max(100).nullable(),
  storeId: z.number().int().positive().max(2_147_483_647).nullable(),
  event: z.string().min(1).max(80),
  providerStatus: z.string().max(100).nullable(),
  status: z.enum(["reconciliation_required", "unmatched"]),
  errorCode: z
    .string()
    .regex(/^PATHAO_[A-Z0-9_]+$/)
    .max(80)
    .nullable(),
  occurredAt: z.iso.datetime(),
});
export type PathaoManagementIssue = z.infer<typeof PathaoManagementIssueSchema>;

export const PathaoManagementIssuesSchema = z.strictObject({
  issues: z.array(PathaoManagementIssueSchema),
  ...OffsetPaginationMetadataSchema.shape,
});
export type PathaoManagementIssues = z.infer<
  typeof PathaoManagementIssuesSchema
>;

export const PathaoManagementIssuesQuerySchema = OffsetPaginationQuerySchema;
export type PathaoManagementIssuesQuery = z.infer<
  typeof PathaoManagementIssuesQuerySchema
>;

export const PathaoWebhookResolutionInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("recheck"),
      reason: z.string().trim().min(3).max(500),
    }),
    z.strictObject({
      action: z.literal("acknowledge_no_change"),
      reason: z.string().trim().min(3).max(500),
      verifiedInPathaoPanel: z.literal(true),
    }),
  ],
);
export type PathaoWebhookResolutionInput = z.infer<
  typeof PathaoWebhookResolutionInputSchema
>;

export const PathaoWebhookResolutionResultSchema = z.strictObject({
  eventId: z.uuid(),
  action: z.enum(["recheck", "acknowledge_no_change"]),
  status: z.enum(["pending", "ignored"]),
});
export type PathaoWebhookResolutionResult = z.infer<
  typeof PathaoWebhookResolutionResultSchema
>;
