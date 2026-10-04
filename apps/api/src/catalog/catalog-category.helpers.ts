import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CatalogCategoryReference } from "@aaraj/contracts";
import { eq, inArray } from "drizzle-orm";
import type { getDrizzleDatabase } from "../platform/database/database-client.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { catalogCategory } from "./catalog-schema.js";

type CatalogQuery = ReturnType<typeof getDrizzleDatabase> | AuditTransaction;

export async function requireActiveLeafCategory(
  transaction: AuditTransaction,
  categoryId: string,
) {
  const [category] = await transaction
    .select()
    .from(catalogCategory)
    .where(eq(catalogCategory.id, categoryId))
    // Serialize assigning an item with adding a child under this category.
    // Otherwise both transactions could observe it as a leaf and commit an
    // invalid product/size-guide-to-parent assignment.
    .for("update")
    .limit(1);
  if (!category) throw new NotFoundException("Category not found");
  if (!category.isActive) {
    throw new BadRequestException("Select an active product category.");
  }

  const [child] = await transaction
    .select({ id: catalogCategory.id })
    .from(catalogCategory)
    .where(eq(catalogCategory.parentId, category.id))
    .limit(1);
  if (child) {
    throw new BadRequestException(
      "Products and size guides must use a leaf category.",
    );
  }
  return category;
}

export async function loadCategoryReferences(
  transaction: CatalogQuery,
  categoryIds: (string | null)[],
): Promise<Map<string, CatalogCategoryReference>> {
  const ids = [
    ...new Set(categoryIds.filter((id): id is string => id !== null)),
  ];
  if (!ids.length) return new Map();
  const rows = await transaction
    .select({
      id: catalogCategory.id,
      name: catalogCategory.name,
      slug: catalogCategory.slug,
      parentId: catalogCategory.parentId,
    })
    .from(catalogCategory)
    .where(inArray(catalogCategory.id, ids));
  return new Map(rows.map((category) => [category.id, category]));
}

export async function loadCategoryReference(
  transaction: CatalogQuery,
  categoryId: string,
): Promise<CatalogCategoryReference> {
  const categories = await loadCategoryReferences(transaction, [categoryId]);
  const category = categories.get(categoryId);
  if (!category) throw new NotFoundException("Category not found");
  return category;
}
