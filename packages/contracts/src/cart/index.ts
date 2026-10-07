import { z } from "zod";

/** Approved AARAJ cart policy; these values are product decisions. */
export const MAX_CART_LINES = 50;
export const MAX_CART_QUANTITY_PER_VARIANT = 10;
export const CART_SCHEMA_VERSION = 1;
export const CART_CURRENCY = "BDT" as const;
export const CartVariantIdSchema = z.uuid();

const CartRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CartProductSnapshotSchema = z.strictObject({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  color: z.string().min(1).max(80),
  sizeLabel: z.string().min(1).max(40),
  unitPriceBdt: z.number().int().nonnegative().max(2_147_483_647),
  currency: z.literal(CART_CURRENCY),
});
export type CartProductSnapshot = z.infer<typeof CartProductSnapshotSchema>;

export const CartLineSchema = z.strictObject({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  availability: z.enum(["available", "unavailable"]),
  product: CartProductSnapshotSchema,
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.strictObject({
  schemaVersion: z.literal(CART_SCHEMA_VERSION),
  currency: z.literal(CART_CURRENCY),
  revision: CartRevisionSchema,
  lines: z.array(CartLineSchema).max(MAX_CART_LINES),
});
export type Cart = z.infer<typeof CartSchema>;

export const CartSetLineInputSchema = z.strictObject({
  revision: CartRevisionSchema,
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
});
export type CartSetLineInput = z.infer<typeof CartSetLineInputSchema>;

export const CartRevisionQuerySchema = z.strictObject({
  revision: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(CartRevisionSchema),
});
export type CartRevisionQuery = z.infer<typeof CartRevisionQuerySchema>;

export const CartMergeResultSchema = z.strictObject({
  cart: CartSchema,
  guestCartCleanupPending: z.boolean(),
});
export type CartMergeResult = z.infer<typeof CartMergeResultSchema>;
