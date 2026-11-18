import { z } from "zod";
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "../cart/index.js";
import { DeliveryZoneSchema } from "../delivery/index.js";
import { CURRENCY } from "../platform/system-config.js";
import {
  CatalogComboSelectionModeSchema,
  MAX_COMBO_COMPONENTS,
} from "../catalog/combos.js";

export const MAX_QUOTE_COMPONENT_LINES = MAX_CART_LINES * MAX_COMBO_COMPONENTS;

export const QUOTE_SCHEMA_VERSION = 1 as const;
export const QUOTE_CURRENCY = CURRENCY;
export const QUOTE_VALIDITY_POLICY_VERSION =
  "AARAJ_QUOTE_VALIDITY_2026_10_07_V1" as const;
export const QUOTE_VALIDITY_SECONDS = 15 * 60;
export const QuoteIdSchema = z.uuid();

export const QuoteDestinationRefSchema = z.strictObject({
  geographyVersion: z.string().trim().min(1).max(80),
  divisionId: z.uuid(),
  districtId: z.uuid(),
  upazilaId: z.uuid().optional(),
});
export type QuoteDestinationRef = z.infer<typeof QuoteDestinationRefSchema>;

export const QuoteDestinationInputSchema = QuoteDestinationRefSchema;
export type QuoteDestinationInput = QuoteDestinationRef;

const QuoteLineSchema = z.strictObject({
  variantId: z.uuid(),
  selectionIndex: z.number().int().min(0).max(9).optional(),
  comboGroupId: z.uuid().nullable().default(null),
  productName: z.string().min(1).max(160),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  unitPriceBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  compareAtPriceBdt: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .default(null),
  grossAmountBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const QuoteComboGroupSchema = z.strictObject({
  groupId: z.uuid(),
  productId: z.uuid(),
  comboRevision: z.number().int().positive(),
  comboName: z.string().min(1).max(160),
  selectionMode: CatalogComboSelectionModeSchema,
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  unitPriceBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grossAmountBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  selections: z
    .array(
      z.strictObject({
        componentId: z.uuid(),
        selectionIndex: z.number().int().min(0).max(9).optional(),
        variantId: z.uuid(),
        productName: z.string().min(1).max(160),
        color: z.string().min(1).max(80),
        sizeLabel: z.string().min(1).max(40),
        unitPriceBdt: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        compareAtPriceBdt: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .nullable(),
      }),
    )
    .min(2)
    .max(MAX_COMBO_COMPONENTS),
});

export const AuthoritativeQuoteSchema = z.strictObject({
  schemaVersion: z.literal(QUOTE_SCHEMA_VERSION),
  id: z.uuid(),
  currency: z.literal(QUOTE_CURRENCY),
  cartRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lines: z.array(QuoteLineSchema).max(MAX_QUOTE_COMPONENT_LINES),
  comboGroups: z.array(QuoteComboGroupSchema).max(MAX_CART_LINES).default([]),
  merchandiseGrossBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  destination: z.strictObject({
    geographyVersion: z.string().min(1).max(80),
    divisionId: z.uuid(),
    divisionName: z.string().min(1).max(120),
    districtId: z.uuid(),
    districtName: z.string().min(1).max(120),
    upazilaId: z.uuid().nullable(),
    upazilaName: z.string().min(1).max(120).nullable(),
  }),
  delivery: z.strictObject({
    tariffVersion: z.string().min(1).max(80),
    effectiveFrom: z.iso.date(),
    zone: DeliveryZoneSchema.nullable().default(null),
    grossAmountBdt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
  totalBdt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  validityPolicyVersion: z.literal(QUOTE_VALIDITY_POLICY_VERSION),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type AuthoritativeQuote = z.infer<typeof AuthoritativeQuoteSchema>;

export const QuoteLookupSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("current"),
    quote: AuthoritativeQuoteSchema,
  }),
  z.strictObject({
    status: z.literal("stale"),
    quoteId: z.uuid(),
    reason: z.enum([
      "cart_changed",
      "catalog_changed",
      "destination_requoted",
      "delivery_tariff_changed",
    ]),
  }),
  z.strictObject({
    status: z.literal("expired"),
    quoteId: z.uuid(),
    expiresAt: z.iso.datetime(),
  }),
]);
export type QuoteLookup = z.infer<typeof QuoteLookupSchema>;
