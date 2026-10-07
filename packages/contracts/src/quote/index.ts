import { z } from "zod";
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "../cart/index.js";

export const QUOTE_SCHEMA_VERSION = 1 as const;
export const QUOTE_CURRENCY = "BDT" as const;
export const QUOTE_VALIDITY_POLICY_VERSION =
  "AARAJ_QUOTE_VALIDITY_2026_10_07_V1" as const;
export const QUOTE_VALIDITY_SECONDS = 15 * 60;
export const QuoteIdSchema = z.uuid();

const AddressTextSchema = z.string().trim().min(1).max(240);

export const QuoteDestinationInputSchema = z.strictObject({
  geographyVersion: z.string().trim().min(1).max(80),
  divisionId: z.uuid(),
  districtId: z.uuid(),
  upazilaId: z.uuid().optional(),
  recipientName: AddressTextSchema.max(120),
  recipientPhone: z
    .string()
    .trim()
    .min(6)
    .max(24)
    .regex(/^[+0-9()\-\s]+$/),
  locality: AddressTextSchema.max(120),
  street: z.string().trim().max(160).optional(),
  building: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(16).optional(),
  deliveryInstructions: z.string().trim().max(300).optional(),
});
export type QuoteDestinationInput = z.infer<typeof QuoteDestinationInputSchema>;

export const QuoteDestinationRefSchema = z.strictObject({
  geographyVersion: z.string().trim().min(1).max(80),
  divisionId: z.uuid(),
  districtId: z.uuid(),
  upazilaId: z.uuid().optional(),
});
export type QuoteDestinationRef = z.infer<typeof QuoteDestinationRefSchema>;

const QuoteLineSchema = z.strictObject({
  variantId: z.uuid(),
  productName: z.string().min(1).max(160),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  unitPriceBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  grossAmountBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const QuoteTaxComponentSchema = z.strictObject({
  treatment: z.enum(["taxable", "exempt"]),
  grossAmountBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  taxableBaseBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  taxAmountBdt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  rateNumerator: z.number().int().positive().nullable(),
  rateDenominator: z.number().int().positive().nullable(),
});
export type QuoteTaxComponent = z.infer<typeof QuoteTaxComponentSchema>;

export const AuthoritativeQuoteSchema = z.strictObject({
  schemaVersion: z.literal(QUOTE_SCHEMA_VERSION),
  id: z.uuid(),
  currency: z.literal(QUOTE_CURRENCY),
  cartRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lines: z.array(QuoteLineSchema).max(MAX_CART_LINES),
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
    grossAmountBdt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    tax: QuoteTaxComponentSchema,
  }),
  tax: z.strictObject({
    profileVersion: z.string().min(1).max(80),
    sourceReference: z.string().min(1).max(500),
    sourceVersion: z.string().min(1).max(120),
    pricePresentation: z.literal("vat_inclusive"),
    roundingRule: z.literal("half_up_bdt_v1"),
    merchandise: QuoteTaxComponentSchema,
    totalTaxAmountBdt: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
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
      "tax_rule_changed",
    ]),
  }),
  z.strictObject({
    status: z.literal("expired"),
    quoteId: z.uuid(),
    expiresAt: z.iso.datetime(),
  }),
]);
export type QuoteLookup = z.infer<typeof QuoteLookupSchema>;
