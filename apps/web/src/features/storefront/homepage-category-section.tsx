import type { CatalogPublishedCategoryOption } from "@aaraj/contracts";
import { Heading } from "@/components/ui/heading";
import { HomepageCategoryGrid } from "./homepage-category-grid";

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
      <Heading
        as="h2"
        className="mb-6 sm:mb-8"
        id="homepage-categories-title"
        variant="section"
      >
        Featured categories
      </Heading>
      <HomepageCategoryGrid categories={categories} />
    </section>
  );
}
