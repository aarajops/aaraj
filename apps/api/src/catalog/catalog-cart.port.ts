import type { CartLineImage } from "@aaraj/contracts";

export const CATALOG_CART_PORT = Symbol("CATALOG_CART_PORT");

export type CatalogCartVariant = {
  variantId: string;
  slug: string;
  name: string;
  color: string;
  sizeLabel: string;
  unitPriceBdt: number;
  currency: "BDT";
  image: CartLineImage | null;
};

export interface CatalogCartPort {
  findPurchasableVariants(
    variantIds: readonly string[],
    options?: { includeImages?: boolean },
  ): Promise<CatalogCartVariant[]>;
}
