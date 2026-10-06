import { Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import type {
  CatalogInventoryPort,
  InventoryCatalogVariant,
} from "./catalog-inventory.port.js";
import type { InventoryListQuery } from "@aaraj/contracts";
import { catalogProduct, catalogProductVariant } from "./catalog-schema.js";

@Injectable()
export class CatalogInventoryReader implements CatalogInventoryPort {
  constructor(private readonly database: DatabaseService) {}

  async listActiveVariants(
    query: Pick<InventoryListQuery, "limit" | "offset" | "search">,
  ): Promise<{ variants: InventoryCatalogVariant[]; hasMore: boolean }> {
    const search = query.search
      ? `%${escapeLikeWildcards(query.search)}%`
      : undefined;
    const rows = await this.database.db
      .select({
        id: catalogProductVariant.id,
        sku: catalogProductVariant.sku,
        productName: catalogProduct.name,
        color: catalogProductVariant.color,
        sizeLabel: catalogProductVariant.sizeLabel,
      })
      .from(catalogProductVariant)
      .innerJoin(
        catalogProduct,
        eq(catalogProduct.id, catalogProductVariant.productId),
      )
      .where(
        and(
          eq(catalogProductVariant.isActive, true),
          search
            ? or(
                ilike(catalogProduct.name, search),
                ilike(catalogProductVariant.sku, search),
                ilike(catalogProductVariant.color, search),
                ilike(catalogProductVariant.sizeLabel, search),
              )
            : undefined,
        ),
      )
      .orderBy(
        asc(catalogProduct.name),
        asc(catalogProductVariant.sku),
        asc(catalogProductVariant.id),
      )
      .limit(query.limit + 1)
      .offset(query.offset);

    return {
      variants: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
    };
  }

  async findActiveVariant(
    variantId: string,
  ): Promise<InventoryCatalogVariant | null> {
    const [variant] = await this.database.db
      .select({
        id: catalogProductVariant.id,
        sku: catalogProductVariant.sku,
        productName: catalogProduct.name,
        color: catalogProductVariant.color,
        sizeLabel: catalogProductVariant.sizeLabel,
      })
      .from(catalogProductVariant)
      .innerJoin(
        catalogProduct,
        eq(catalogProduct.id, catalogProductVariant.productId),
      )
      .where(
        and(
          eq(catalogProductVariant.id, variantId),
          eq(catalogProductVariant.isActive, true),
        ),
      )
      .limit(1);
    return variant ?? null;
  }
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
