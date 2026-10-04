import { Suspense } from "react";
import Link from "next/link";
import { CatalogFilters } from "@/features/catalog/catalog-filters";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import {
  getPublishedProducts,
  parsePublishedCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";

export default function Home({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  return (
    <Suspense fallback={<CatalogLoading />}>
      <PublishedProductList searchParams={searchParams} />
    </Suspense>
  );
}

async function PublishedProductList({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parsePublishedCatalogPageQuery(await searchParams);
  const page = await getPublishedProducts(query);
  const hasActiveFilters = Boolean(
    query.audience || query.category || query.color || query.size,
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-14 text-foreground sm:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          THE AARAJ CATALOG
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Products
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Explore products in the Aaraj catalog.
            </p>
          </div>
          <Link
            className="rounded-lg border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:border-ring"
            href="/account"
          >
            Your account
          </Link>
        </div>

        <CatalogFilters options={page?.filters ?? null} query={query} />

        {page === null ? (
          <p
            className="mt-10 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            The catalog is temporarily unavailable. Please try again shortly.
          </p>
        ) : page.products.length === 0 ? (
          <p className="mt-10 rounded-xl border border-border bg-card/60 p-8 text-secondary-foreground">
            {hasActiveFilters
              ? "No products match these filters. Try changing or clearing them."
              : "No products are published yet. Please check back soon."}
          </p>
        ) : (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {page.products.map((product) => (
              <li key={product.id}>
                <Link
                  className="group flex h-full flex-col rounded-2xl border border-border bg-card/70 p-6 transition hover:border-primary/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  href={`/products/${product.slug}`}
                >
                  <h2 className="text-xl font-semibold text-foreground group-hover:text-accent-foreground">
                    {product.name}
                  </h2>
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {product.description || "View product details."}
                  </p>
                  <span className="mt-6 text-sm font-medium text-primary">
                    View details <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page && (
          <CatalogPagination
            label="Public catalog"
            pathname="/"
            limit={query.limit}
            offset={query.offset}
            productCount={page.products.length}
            hasMore={page.hasMore}
            nextOffset={page.nextOffset}
            preservedParams={{
              audience: query.audience,
              category: query.category,
              color: query.color,
              size: query.size,
            }}
          />
        )}
      </div>
    </main>
  );
}

function CatalogLoading() {
  return (
    <main
      className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-14 text-muted-foreground sm:py-20"
      role="status"
    >
      <div className="mx-auto max-w-6xl">Loading Aaraj products…</div>
    </main>
  );
}
