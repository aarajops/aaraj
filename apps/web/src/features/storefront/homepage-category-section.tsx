import type { CatalogCategoryOption } from "@aaraj/contracts";
import { Heading } from "@/components/ui/heading";
import { HomepageCategoryCarousel } from "./homepage-category-carousel";

export function HomepageCategorySection({
  categories,
}: {
  categories: CatalogCategoryOption[];
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
        Shop by category
      </Heading>
      <HomepageCategoryCarousel categories={categories} />
    </section>
  );
}
