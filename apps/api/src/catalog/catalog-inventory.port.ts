import type { InventoryListQuery } from "@aaraj/contracts";
import type { AuditTransaction } from "../platform/audit/audit.types.js";

export const CATALOG_INVENTORY_PORT = Symbol("CATALOG_INVENTORY_PORT");

export type InventoryCatalogVariant = {
  id: string;
  sku: string;
  productName: string;
  color: string;
  sizeLabel: string;
  isActive: boolean;
};

export interface CatalogInventoryPort {
  listVariants(
    query: Pick<InventoryListQuery, "limit" | "offset" | "search">,
  ): Promise<{ variants: InventoryCatalogVariant[]; hasMore: boolean }>;
  findVariant(variantId: string): Promise<InventoryCatalogVariant | null>;
  findVariantForAdjustment(
    transaction: AuditTransaction,
    variantId: string,
  ): Promise<Pick<InventoryCatalogVariant, "id" | "sku" | "isActive"> | null>;
}
