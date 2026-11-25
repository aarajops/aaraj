import { z } from "zod";
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "../cart/index.js";
import { CatalogComboSelectionsSchema } from "../catalog/combos.js";
import { AuthoritativeQuoteSchema } from "../quote/index.js";
import { CheckoutAddressInputSchema } from "./checkout-address.js";

const ManualOrderVariantSchema = z.strictObject({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
});

const ManualOrderComboSchema = z.strictObject({
  lineId: z.uuid(),
  productId: z.uuid(),
  comboRevision: z.number().int().positive(),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  selections: CatalogComboSelectionsSchema,
});

export const ManualOrderInputSchema = z
  .strictObject({
    customerId: z.string().trim().min(1).max(128).nullable(),
    address: CheckoutAddressInputSchema,
    lines: z.array(ManualOrderVariantSchema).max(MAX_CART_LINES),
    combos: z.array(ManualOrderComboSchema).max(MAX_CART_LINES),
  })
  .check(({ value, issues }) => {
    if (value.lines.length + value.combos.length > MAX_CART_LINES) {
      issues.push({
        code: "custom",
        path: ["combos"],
        message: `An Order can contain at most ${MAX_CART_LINES} item groups.`,
        input: value.combos,
      });
    }
    if (
      new Set(value.lines.map(({ variantId }) => variantId)).size !==
      value.lines.length
    ) {
      issues.push({
        code: "custom",
        path: ["lines"],
        message: "Combine quantities for each variant into one Order line.",
        input: value.lines,
      });
    }
    if (
      new Set(value.combos.map(({ lineId }) => lineId)).size !==
      value.combos.length
    ) {
      issues.push({
        code: "custom",
        path: ["combos"],
        message: "Each combo Order line must have a unique ID.",
        input: value.combos,
      });
    }
  });
export type ManualOrderInput = z.infer<typeof ManualOrderInputSchema>;

export const ManualOrderPreviewSchema = z.strictObject({
  lines: AuthoritativeQuoteSchema.shape.lines,
  comboGroups: AuthoritativeQuoteSchema.shape.comboGroups,
  merchandiseGrossBdt: z.number().int().nonnegative(),
  deliveryAmountBdt: z.number().int().positive(),
  totalBdt: z.number().int().positive(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ManualOrderPreview = z.infer<typeof ManualOrderPreviewSchema>;

export const ManualOrderCreateInputSchema = ManualOrderInputSchema.extend({
  acceptedTotalBdt: z.number().int().positive(),
  previewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  customerAgreed: z.literal(true),
});
export type ManualOrderCreateInput = z.infer<
  typeof ManualOrderCreateInputSchema
>;
