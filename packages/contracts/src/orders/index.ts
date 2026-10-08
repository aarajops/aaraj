import { z } from "zod";
import { QuoteIdSchema, type AuthoritativeQuote } from "../quote/index.js";

export const ORDER_PHONE_POLICY = "BD_MOBILE_E164_V1" as const;
export const ORDER_GUEST_ACCESS_DAYS = 30;
export const ORDER_SERVICEABILITY_REVIEW_DEADLINE_HOURS = 168;
export const ORDER_CURRENCY = "BDT" as const;

export const CheckoutAddressInputSchema = z.strictObject({
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(32),
  geographyVersion: z.string().trim().min(1).max(80),
  divisionId: z.uuid(),
  districtId: z.uuid(),
  upazilaId: z.uuid().optional(),
  locality: z.string().trim().min(2).max(160),
  doorstepDetails: z.string().trim().min(3).max(400),
  street: z.string().trim().max(160).optional(),
  house: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  instructions: z.string().trim().max(400).optional(),
});
export type CheckoutAddressInput = z.infer<typeof CheckoutAddressInputSchema>;

export const CreateOrderInputSchema = z.strictObject({
  quoteId: QuoteIdSchema,
  address: CheckoutAddressInputSchema,
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const OrderIdSchema = z.uuid();
export const OrderIdempotencyKeySchema = z.uuid();
export const OrderListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

export const OrderServiceabilityInputSchema = z.strictObject({
  outcome: z.enum(["serviceable", "unserviceable"]),
  reason: z.string().trim().min(3).max(500),
});
export type OrderServiceabilityInput = z.infer<
  typeof OrderServiceabilityInputSchema
>;

const OrderLineSchema = z.strictObject({
  variantId: z.uuid(),
  productName: z.string().min(1).max(160),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(10),
  unitPriceBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  grossAmountBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const OrderTaxComponentSchema = z.strictObject({
  treatment: z.enum(["taxable", "exempt"]),
  grossAmountBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxableBaseBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxAmountBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rateNumerator: z.number().int().positive().nullable(),
  rateDenominator: z.number().int().positive().nullable(),
});

export const OrderAddressSchema = z.strictObject({
  recipientName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+8801[3-9]\d{8}$/),
  geographyVersion: z.string().min(1).max(80),
  divisionId: z.uuid(),
  divisionName: z.string().min(1).max(120),
  districtId: z.uuid(),
  districtName: z.string().min(1).max(120),
  upazilaId: z.uuid().nullable(),
  upazilaName: z.string().min(1).max(120).nullable(),
  locality: z.string().min(2).max(160),
  doorstepDetails: z.string().min(3).max(400),
  street: z.string().max(160).nullable(),
  house: z.string().max(120).nullable(),
  postalCode: z.string().max(20).nullable(),
  instructions: z.string().max(400).nullable(),
});
export type OrderAddress = z.infer<typeof OrderAddressSchema>;

export const OrderSchema = z.strictObject({
  id: OrderIdSchema,
  reference: z.string().regex(/^AA-[0-9A-F]{12}$/),
  currency: z.literal(ORDER_CURRENCY),
  status: z.enum([
    "awaiting_confirmation",
    "confirmed",
    "rejected",
    "cancelled",
  ]),
  serviceability: z.enum([
    "pending_manual_review",
    "serviceable",
    "unserviceable",
  ]),
  paymentMethod: z.literal("cod"),
  collectionStatus: z.literal("uncollected"),
  fulfillmentStatus: z.enum(["not_started", "awaiting_dispatch", "cancelled"]),
  lines: z.array(OrderLineSchema).min(1).max(50),
  merchandiseGrossBdt: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  tax: z.strictObject({
    profileVersion: z.string().min(1).max(80),
    sourceReference: z.string().min(1).max(500),
    sourceVersion: z.string().min(1).max(120),
    roundingRule: z.literal("half_up_bdt_v1"),
    merchandise: OrderTaxComponentSchema,
    delivery: OrderTaxComponentSchema,
    totalTaxAmountBdt: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  }),
  delivery: z.strictObject({
    tariffVersion: z.string().min(1).max(80),
    effectiveFrom: z.iso.date(),
    grossAmountBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  totalBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  codAmountDueBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cancellationReason: z.enum(["serviceability_review_timeout"]).nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  address: OrderAddressSchema,
  createdAt: z.iso.datetime(),
  guestAccessExpiresAt: z.iso.datetime().nullable(),
});
export type Order = z.infer<typeof OrderSchema>;

export const OrderCreatedSchema = z.strictObject({
  id: OrderIdSchema,
  reference: z.string().regex(/^AA-[0-9A-F]{12}$/),
  totalBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  codAmountDueBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum([
    "awaiting_confirmation",
    "confirmed",
    "rejected",
    "cancelled",
  ]),
  serviceability: z.enum([
    "pending_manual_review",
    "serviceable",
    "unserviceable",
  ]),
  paymentMethod: z.literal("cod"),
  collectionStatus: z.literal("uncollected"),
  fulfillmentStatus: z.enum(["not_started", "awaiting_dispatch", "cancelled"]),
  createdAt: z.iso.datetime(),
  guestAccessExpiresAt: z.iso.datetime().nullable(),
  replayed: z.boolean(),
});
export type OrderCreated = z.infer<typeof OrderCreatedSchema>;

export const OrderManagementListSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      id: OrderIdSchema,
      reference: z.string().regex(/^AA-[0-9A-F]{12}$/),
      status: z.enum([
        "awaiting_confirmation",
        "confirmed",
        "rejected",
        "cancelled",
      ]),
      serviceability: z.enum([
        "pending_manual_review",
        "serviceable",
        "unserviceable",
      ]),
      totalBdt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      createdAt: z.iso.datetime(),
    }),
  ),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0).max(10_000),
  hasMore: z.boolean(),
});
export type OrderManagementList = z.infer<typeof OrderManagementListSchema>;

export type OrderQuoteSnapshot = AuthoritativeQuote;
