import { z } from "zod";
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "../cart/index.js";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";
import { QuoteDestinationRefSchema } from "../quote/index.js";
import { CheckoutAddressInputSchema } from "./checkout-address.js";

export const CheckoutDraftSaveSchema = z.strictObject({
  recipientName: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(32),
  doorstepDetails: z.string().trim().max(400).default(""),
  quoteId: z.uuid().nullable().default(null),
  expectedVersion: z.number().int().nonnegative().nullable().default(null),
});
export type CheckoutDraftSave = z.infer<typeof CheckoutDraftSaveSchema>;

export const CheckoutDraftSaveResultSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
});

const DraftItemSchema = z.strictObject({
  variantId: z.uuid(),
  productName: z.string(),
  color: z.string(),
  sizeLabel: z.string(),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
});

export const CheckoutDraftOutcomeSchema = z.enum([
  "new",
  "no_answer",
  "interested",
  "call_back",
  "declined",
  "do_not_contact",
]);

export const CheckoutDraftListQuerySchema = OffsetPaginationQuerySchema;
export type CheckoutDraftListQuery = z.infer<
  typeof CheckoutDraftListQuerySchema
>;

export const CheckoutDraftListSchema = z.strictObject({
  rows: z.array(
    z.strictObject({
      id: z.uuid(),
      customerName: z.string(),
      maskedPhone: z.string(),
      items: z.array(DraftItemSchema).max(MAX_CART_LINES),
      estimatedTotalBdt: z.number().int().nonnegative().nullable(),
      deliveryZone: z.string().nullable(),
      outcome: CheckoutDraftOutcomeSchema,
      attemptCount: z.number().int().nonnegative(),
      lastCustomerActivityAt: z.iso.datetime(),
    }),
  ),
  ...OffsetPaginationMetadataSchema.shape,
});
export type CheckoutDraftList = z.infer<typeof CheckoutDraftListSchema>;

export const CheckoutDraftDetailSchema =
  CheckoutDraftListSchema.shape.rows.element.extend({
    phone: z.string(),
    doorstepDetails: z.string(),
    version: z.number().int().positive(),
    cartRevision: z.number().int().nonnegative(),
    destination: QuoteDestinationRefSchema.nullable(),
    callbackAt: z.iso.datetime().nullable(),
  });
export type CheckoutDraftDetail = z.infer<typeof CheckoutDraftDetailSchema>;

export const CheckoutDraftOutcomeInputSchema = z.strictObject({
  outcome: z.enum([
    "no_answer",
    "interested",
    "call_back",
    "declined",
    "do_not_contact",
  ]),
  callbackAt: z.iso.datetime().optional(),
  expectedVersion: z.number().int().positive(),
});
export type CheckoutDraftOutcomeInput = z.infer<
  typeof CheckoutDraftOutcomeInputSchema
>;

export const CheckoutDraftPreviewInputSchema = z.strictObject({
  address: CheckoutAddressInputSchema,
  expectedVersion: z.number().int().positive(),
});
export type CheckoutDraftPreviewInput = z.infer<
  typeof CheckoutDraftPreviewInputSchema
>;

export const CheckoutDraftPreviewSchema = z.strictObject({
  draftVersion: z.number().int().positive(),
  lines: z
    .array(
      DraftItemSchema.extend({
        unitPriceBdt: z.number().int().nonnegative(),
        grossAmountBdt: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(MAX_CART_LINES),
  merchandiseGrossBdt: z.number().int().nonnegative(),
  deliveryAmountBdt: z.number().int().positive(),
  totalBdt: z.number().int().positive(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CheckoutDraftPreview = z.infer<typeof CheckoutDraftPreviewSchema>;

export const CheckoutDraftCreateOrderInputSchema =
  CheckoutDraftPreviewInputSchema.extend({
    acceptedTotalBdt: z.number().int().positive(),
    previewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    customerAgreed: z.literal(true),
  });
export type CheckoutDraftCreateOrderInput = z.infer<
  typeof CheckoutDraftCreateOrderInputSchema
>;
