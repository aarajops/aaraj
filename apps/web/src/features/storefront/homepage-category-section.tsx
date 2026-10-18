import type { CatalogPublishedCategoryOption } from "@aaraj/contracts";
import { HomepageCategoryCarousel } from "./homepage-category-carousel";

export function HomepageCategorySection({
  categories,
}: {
  categories: CatalogPublishedCategoryOption[];
}) {
  if (categories.length === 0) return null;

  return (
    <section
      aria-labelledby="homepage-categories-title"
      className="pb-10 sm:pb-14"
    >
      <h2
        className="mb-6 text-center text-2xl font-semibold tracking-tight text-foreground sm:mb-8 sm:text-3xl"
        id="homepage-categories-title"
      >
        Shop by category
      </h2>
      <HomepageCategoryCarousel categories={categories} />
    </section>
  );
}
