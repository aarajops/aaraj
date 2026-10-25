import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CatalogCategoryReference } from "@aaraj/contracts";
import { eq, inArray } from "drizzle-orm";
import type { getDrizzleDatabase } from "../platform/database/database-client.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { catalogCategory } from "./catalog-schema.js";

type CatalogQuery = ReturnType<typeof getDrizzleDatabase> | AuditTransaction;

export async function requireActiveCategory(
  transaction: AuditTransaction,
  categoryId: string,
) {
  const [category] = await transaction
    .select()
    .from(catalogCategory)
    .where(eq(catalogCategory.id, categoryId))
    // Serialize active-state changes with category assignments.
    .for("update")
    .limit(1);
  if (!category) throw new NotFoundException("Category not found");
  if (!category.isActive) {
    throw new BadRequestException("Select an active category.");
  }
  return category;
}

export async function requireActiveLeafCategory(
  transaction: AuditTransaction,
  categoryId: string,
) {
  const category = await requireActiveCategory(transaction, categoryId);
  const [child] = await transaction
    .select({ id: catalogCategory.id })
    .from(catalogCategory)
    .where(eq(catalogCategory.parentId, category.id))
    .limit(1);
  if (child) {
    throw new BadRequestException("Products must use a leaf category.");
  }
  return category;
}

export async function loadCategoryParentMap(
  transaction: CatalogQuery,
): Promise<Map<string, string | null>> {
  const categories = await transaction
    .select({
      id: catalogCategory.id,
      parentId: catalogCategory.parentId,
    })
    .from(catalogCategory);
  return new Map(categories.map(({ id, parentId }) => [id, parentId]));
}

export function isCategoryOrDescendant(
  categoryId: string | null,
  ancestorId: string,
  parentIds: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>();
  let currentId = categoryId;
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = parentIds.get(currentId) ?? null;
  }
  return false;
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
