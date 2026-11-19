import type { CatalogPublishedCategoryOption } from "@aaraj/contracts";

export function resolveHomepageCategories(
  enabled: boolean,
  categoryIds: readonly string[],
  publishedCategories: readonly CatalogPublishedCategoryOption[],
): CatalogPublishedCategoryOption[] {
  if (!enabled || categoryIds.length === 0) return [];

  const categoriesById = new Map(
    publishedCategories
      .filter(({ publishedProductCount }) => publishedProductCount > 0)
      .map((category) => [category.id, category]),
  );
  const seen = new Set<string>();

  return categoryIds.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const category = categoriesById.get(id);
    return category ? [category] : [];
  });
}
