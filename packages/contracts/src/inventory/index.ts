import { z } from "zod";
import {
  OffsetPaginationMetadataSchema,
  OffsetPaginationQuerySchema,
} from "../common/pagination.js";

const OptionalInventorySearchSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).max(160).optional(),
);

export const InventoryListQuerySchema = OffsetPaginationQuerySchema.extend({
  search: OptionalInventorySearchSchema,
});
export type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;

export const InventoryVariantSchema = z.strictObject({
  id: z.uuid(),
  sku: z.string().min(1).max(100),
  productName: z.string().min(1).max(160),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  quantityOnHand: z.number().int().nonnegative().max(2_147_483_647),
  quantityReserved: z.number().int().nonnegative().max(2_147_483_647),
  quantityAvailable: z.number().int().nonnegative().max(2_147_483_647),
  stockUpdatedAt: z.iso.datetime().nullable(),
});
export type InventoryVariant = z.infer<typeof InventoryVariantSchema>;

export const InventoryVariantPageSchema = z.strictObject({
  variants: z.array(InventoryVariantSchema),
  ...OffsetPaginationMetadataSchema.shape,
});
export type InventoryVariantPage = z.infer<typeof InventoryVariantPageSchema>;

export const InventoryVariantIdSchema = z.uuid();

export const InventoryAdjustmentInputSchema = z.strictObject({
  commandId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-2_147_483_647)
    .max(2_147_483_647)
    .refine(
      (value) => value !== 0,
      "Stock adjustment must change the quantity.",
    ),
  reason: z.string().trim().min(3).max(500),
});
export type InventoryAdjustmentInput = z.infer<
  typeof InventoryAdjustmentInputSchema
>;

export const InventoryAdjustmentResultSchema = z.strictObject({
  variantId: z.uuid(),
  commandId: z.uuid(),
  delta: z.number().int(),
  quantityOnHand: z.number().int().nonnegative().max(2_147_483_647),
  updatedAt: z.iso.datetime(),
});
export type InventoryAdjustmentResult = z.infer<
  typeof InventoryAdjustmentResultSchema
>;
