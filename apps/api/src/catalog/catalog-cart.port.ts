import { CURRENCY, type CartLineImage } from "@aaraj/contracts";
import type { AuditTransaction } from "../platform/audit/audit.types.js";

export const CATALOG_CART_PORT = Symbol("CATALOG_CART_PORT");

export type CatalogCartVariant = {
  variantId: string;
  slug: string;
  name: string;
  color: string;
  sizeLabel: string;
  unitPriceBdt: number;
  compareAtPriceBdt: number | null;
  currency: typeof CURRENCY;
  image: CartLineImage | null;
};

export type PurchasableCatalogVariant = Pick<
  CatalogCartVariant,
  | "variantId"
  | "name"
  | "color"
  | "sizeLabel"
  | "unitPriceBdt"
  | "compareAtPriceBdt"
>;

export interface CatalogCartPort {
  findPurchasableVariants(
    variantIds: readonly string[],
    options?: { includeImages?: boolean },
  ): Promise<CatalogCartVariant[]>;
  findPurchasableVariantsWithinTransaction(
    transaction: AuditTransaction,
    variantIds: readonly string[],
  ): Promise<PurchasableCatalogVariant[]>;
}
