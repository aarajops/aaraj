import { Suspense } from "react";
import Link from "next/link";
import { CatalogPagination } from "@/features/catalog/catalog-pagination";
import {
  getPublishedProducts,
  parseCatalogPageQuery,
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
  const query = parseCatalogPageQuery(await searchParams);
  const page = await getPublishedProducts(query);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-zinc-950 px-5 py-14 text-zinc-100 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-300">
          THE AARAJ CATALOG
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Products
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400">
              Browse products currently available from Aaraj.
            </p>
          </div>
          <Link
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
            href="/account"
          >
            Your account
          </Link>
        </div>

        {page === null ? (
          <p
            className="mt-10 rounded-xl border border-amber-900/70 bg-amber-950/30 p-5 text-amber-100"
            role="alert"
          >
            The catalog is temporarily unavailable. Please try again shortly.
          </p>
        ) : page.products.length === 0 ? (
          <p className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-zinc-300">
            No products are published yet. Please check back soon.
          </p>
        ) : (
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {page.products.map((product) => (
              <li key={product.id}>
                <Link
                  className="group flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 transition hover:border-emerald-700 hover:bg-zinc-900"
                  href={`/products/${product.slug}`}
                >
                  <h2 className="text-xl font-semibold text-white group-hover:text-emerald-200">
                    {product.name}
                  </h2>
                  <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                    {product.description || "View product details."}
                  </p>
                  <span className="mt-6 text-sm font-medium text-emerald-300">
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
          />
        )}
      </div>
    </main>
  );
}

function CatalogLoading() {
  return (
    <main
      className="min-h-[calc(100vh-4rem)] flex-1 bg-zinc-950 px-5 py-14 text-zinc-400 sm:py-20"
      role="status"
    >
      <div className="mx-auto max-w-6xl">Loading Aaraj products…</div>
    </main>
  );
}
