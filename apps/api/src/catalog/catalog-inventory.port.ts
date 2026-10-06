import type { InventoryListQuery } from "@aaraj/contracts";

export const CATALOG_INVENTORY_PORT = Symbol("CATALOG_INVENTORY_PORT");

export type InventoryCatalogVariant = {
  id: string;
  sku: string;
  productName: string;
  color: string;
  sizeLabel: string;
};

export interface CatalogInventoryPort {
  listActiveVariants(
    query: Pick<InventoryListQuery, "limit" | "offset" | "search">,
  ): Promise<{ variants: InventoryCatalogVariant[]; hasMore: boolean }>;
  findActiveVariant(variantId: string): Promise<InventoryCatalogVariant | null>;
}
