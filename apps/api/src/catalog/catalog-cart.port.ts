export const CATALOG_CART_PORT = Symbol("CATALOG_CART_PORT");

export type CatalogCartVariant = {
  variantId: string;
  slug: string;
  name: string;
  color: string;
  sizeLabel: string;
  unitPriceBdt: number;
  currency: "BDT";
};

export interface CatalogCartPort {
  findPurchasableVariants(
    variantIds: readonly string[],
  ): Promise<CatalogCartVariant[]>;
}
