import Link from "next/link";
import type {
  CatalogAudience,
  CatalogCategoryReference,
  CatalogPrice,
} from "@aaraj/contracts";
import { CarouselItem } from "@/components/ui/carousel";
import { ProductCard } from "@/features/catalog/product-card";
import { getPublishedProducts } from "@/features/catalog/catalog-queries";
import { RelatedProductsCarousel } from "./related-products-carousel";

const RELATED_PRODUCTS_FETCH_LIMIT = 12;
const RELATED_PRODUCTS_DISPLAY_LIMIT = 8;

type RelatedProductsSource = {
  id: string;
  audience: CatalogAudience | null;
  category: CatalogCategoryReference | null;
  price: CatalogPrice | null;
};

export async function RelatedProductsSection({
  product,
}: {
  product: RelatedProductsSource;
}) {
  const { audience, category } = product;
  if (!audience || !category) return null;

  const page = await getPublishedProducts({
    limit: RELATED_PRODUCTS_FETCH_LIMIT,
    offset: 0,
    sort: "newest",
    audience,
    category: category.slug,
  });
  if (!page) return null;

  const relatedProducts = page.products
    .filter(
      (candidate) =>
        candidate.id !== product.id && candidate.audience === audience,
    )
    .sort((left, right) => {
      const leftExactCategory = left.category?.id === category.id;
      const rightExactCategory = right.category?.id === category.id;
      if (leftExactCategory !== rightExactCategory) {
        return leftExactCategory ? -1 : 1;
      }

      const sourcePrice = product.price?.amountBdt;
      if (sourcePrice !== undefined) {
        const leftDistance = Math.abs(
          (left.price?.amountBdt ?? Number.POSITIVE_INFINITY) - sourcePrice,
        );
        const rightDistance = Math.abs(
          (right.price?.amountBdt ?? Number.POSITIVE_INFINITY) - sourcePrice,
        );
        if (leftDistance !== rightDistance) {
          return leftDistance < rightDistance ? -1 : 1;
        }
      }

      return (
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    })
    .slice(0, RELATED_PRODUCTS_DISPLAY_LIMIT);

  if (relatedProducts.length < 2) return null;

  const categoryHref = `/shop/categories/${encodeURIComponent(category.slug)}?audience=${encodeURIComponent(audience)}`;

  return (
    <section className="border-t border-border pt-7 sm:pt-9">
      <RelatedProductsCarousel categoryName={category.name}>
        {relatedProducts.map((relatedProduct, index) => (
          <CarouselItem
            aria-label={`${index + 1} of ${relatedProducts.length}: ${relatedProduct.name}`}
            className="basis-[78%] pl-3 min-[480px]:basis-1/2 md:basis-1/3 xl:basis-1/4"
            key={relatedProduct.id}
          >
            <ProductCard
              headingLevel="h3"
              imageRatio={1}
              product={relatedProduct}
            />
          </CarouselItem>
        ))}
      </RelatedProductsCarousel>
      <div className="mt-5 text-center">
        <Link
          className="rounded-sm text-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={categoryHref}
        >
          Shop all {category.name}
        </Link>
      </div>
    </section>
  );
}
