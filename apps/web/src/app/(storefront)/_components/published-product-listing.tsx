import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type CatalogPublishedProductListQuery } from "@aaraj/contracts";
import { buttonVariants } from "@/components/ui/button";
import {
  CatalogFilters,
  CatalogResultsToolbar,
} from "@/features/catalog/catalog-filters";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import { formatCatalogPrice } from "@/features/catalog/price";
import { ProductLinkStatus } from "@/features/catalog/product-link-status";
import {
  getPublishedProducts,
  getStorefrontCategoryBySlug,
  parsePublishedCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";

type PublishedProductListingProps = {
  searchParams: Promise<CatalogPageSearchParams>;
  pathname: string;
  title: string;
  sort?: CatalogPublishedProductListQuery["sort"];
  categorySlug?: string;
};

export async function PublishedProductListing({
  searchParams,
  pathname,
  title,
  sort,
  categorySlug,
}: PublishedProductListingProps) {
  const parsedQuery = parsePublishedCatalogPageQuery(await searchParams);
  if (!parsedQuery) {
    const category = categorySlug
      ? await getStorefrontCategoryBySlug(categorySlug)
      : null;
    if (category?.kind === "not-found") notFound();
    const listingTitle =
      category?.kind === "found" ? category.category.name : title;

    return <InvalidCatalogQuery pathname={pathname} title={listingTitle} />;
  }

  const query = {
    ...parsedQuery,
    ...(categorySlug ? { category: categorySlug } : {}),
    ...(sort && !parsedQuery.sort ? { sort } : {}),
  };
  const page = await getPublishedProducts(query);
  const category = categorySlug
    ? await getStorefrontCategoryBySlug(categorySlug, page?.filters.categories)
    : null;
  if (category?.kind === "not-found") notFound();
  const listingTitle =
    category?.kind === "found" ? category.category.name : title;
  const hasActiveFilters = Boolean(
    query.audience ||
    (!categorySlug && query.category) ||
    query.color ||
    query.size ||
    query.minPriceBdt !== undefined ||
    query.maxPriceBdt !== undefined,
  );
  const hasActiveCriteria = Boolean(query.search || hasActiveFilters);
  const categoryHasNoProducts =
    category?.kind === "found" && category.publishedProductCount === 0;
  const showCategoryEmptyState = Boolean(
    categorySlug && categoryHasNoProducts && !hasActiveCriteria,
  );
  return (
    <>
      <header className="mb-3 flex items-start justify-between gap-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {listingTitle}
        </h1>
        {categorySlug && !showCategoryEmptyState && (
          <Link
            className="mt-2 shrink-0 text-sm font-medium text-primary hover:text-primary/80"
            href="/shop"
          >
            ← All products
          </Link>
        )}
      </header>

      <CatalogFilters
        options={page?.filters ?? null}
        pathname={pathname}
        categoryInPath={Boolean(categorySlug)}
        query={query}
      >
        <CatalogResultsToolbar
          options={page?.filters ?? null}
          pathname={pathname}
          categoryInPath={Boolean(categorySlug)}
          query={query}
          allowSort={!sort && page !== null && page.products.length > 0}
        />
        {page === null ? (
          <p
            className="mt-5 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            The catalog is temporarily unavailable. Please try again shortly.
          </p>
        ) : page.products.length === 0 ? (
          showCategoryEmptyState ? (
            <div className="mt-6 flex flex-col items-center gap-4 text-center">
              <div className="space-y-2" role="status">
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  No products in this category yet
                </h2>
                <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                  See what’s available across the full catalog.
                </p>
              </div>
              <Link className={buttonVariants({ size: "lg" })} href="/shop">
                Browse all products
              </Link>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-4 px-4 py-8 text-center sm:py-10">
              <div className="space-y-2" role="status">
                <h2 className="text-lg font-semibold text-foreground">
                  {hasActiveCriteria
                    ? "No matching products"
                    : "No products are available yet"}
                </h2>
                {hasActiveCriteria && (
                  <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
                    {query.search && hasActiveFilters
                      ? "Try a different search or clear the search and filters."
                      : query.search
                        ? "Try a different search or clear it."
                        : "Try adjusting or clearing the selected filters."}
                  </p>
                )}
              </div>
              {query.search && (
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href={pathname}
                >
                  Clear search{hasActiveFilters ? " and filters" : ""}
                </Link>
              )}
            </div>
          )
        ) : (
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {page.products.map((product) => (
              <li key={product.id}>
                <Link
                  className="group flex h-full flex-col rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  href={`/shop/products/${product.slug}`}
                >
                  {product.images[0] && (
                    <div className="mb-3 aspect-[3/4] overflow-hidden rounded-xl bg-muted/30">
                      <Image
                        alt={product.images[0].altText}
                        className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                        height={product.images[0].card.height}
                        unoptimized
                        src={product.images[0].card.src}
                        width={product.images[0].card.width}
                      />
                    </div>
                  )}
                  <h2 className="text-base font-medium text-foreground group-hover:text-primary">
                    {product.name}
                  </h2>
                  {product.price && (
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      From {formatCatalogPrice(product.price)}
                    </p>
                  )}
                  <ProductLinkStatus />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page && (
          <CatalogPagination
            label={listingTitle}
            pathname={pathname}
            limit={query.limit}
            offset={query.offset}
            productCount={page.products.length}
            hasMore={page.hasMore}
            nextOffset={page.nextOffset}
            preservedParams={{
              search: query.search,
              audience: query.audience,
              category: categorySlug ? undefined : query.category,
              color: query.color,
              size: query.size,
              minPriceBdt:
                query.minPriceBdt === undefined
                  ? undefined
                  : String(query.minPriceBdt),
              maxPriceBdt:
                query.maxPriceBdt === undefined
                  ? undefined
                  : String(query.maxPriceBdt),
              sort: query.sort,
            }}
          />
        )}
      </CatalogFilters>
    </>
  );
}

function InvalidCatalogQuery({
  pathname,
  title,
}: {
  pathname: string;
  title: string;
}) {
  return (
    <>
      <header className="mb-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
      </header>
      <p
        className="mt-8 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
        role="alert"
      >
        The search or filters in this URL are invalid. Clear them to load the
        catalog.
      </p>
      <Link
        className="mt-5 inline-block rounded-lg border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:border-ring"
        href={pathname}
      >
        Clear search and filters
      </Link>
    </>
  );
}
