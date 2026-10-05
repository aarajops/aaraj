import type { Metadata } from "next";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedProducts,
  getManagedSizeGuides,
  parseCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Catalog management",
  description: "Manage products in the Aaraj catalog.",
};

export default async function StaffCatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogPageQuery(await searchParams);
  const [result, guides] = await Promise.all([
    getManagedProducts(query),
    getManagedSizeGuides({ limit: 100, offset: 0 }),
  ]);

  if ("kind" in result) {
    const isUnauthenticated = result.kind === "unauthenticated";
    const isForbidden = result.kind === "forbidden";
    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary">
            AARAJ STAFF
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Catalog management
          </h1>
          <section
            className={`mt-8 rounded-2xl border p-7 ${isForbidden ? "border-destructive/30 bg-destructive/10" : isUnauthenticated ? "border-border bg-card/70" : "border-warning/30 bg-warning/10"}`}
          >
            <h2 className="text-xl font-semibold">
              {result.kind === "unauthenticated"
                ? "Sign in to continue"
                : result.kind === "forbidden"
                  ? "Staff access required"
                  : "Catalog unavailable"}
            </h2>
            <p className="mt-2 text-secondary-foreground">
              {result.kind === "unauthenticated"
                ? "Sign in with an Aaraj staff account to manage products."
                : result.kind === "forbidden"
                  ? "Your account does not have permission to manage the catalog."
                  : "Catalog management could not be loaded. Please try again."}
            </p>
            {result.kind === "unauthenticated" ? (
              <Link
                className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:bg-primary/80"
                href="/account"
              >
                Go to your account
              </Link>
            ) : (
              <Link
                className="mt-5 inline-flex rounded-lg border border-input px-4 py-2.5 font-medium text-foreground hover:border-ring"
                href="/admin/catalog"
              >
                Try again
              </Link>
            )}
          </section>
        </div>
      </main>
    );
  }
  if ("kind" in guides) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Catalog management
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Size guides could not be loaded. Please try again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <CatalogManager
      key={`${query.limit}:${query.offset}`}
      initialPage={result.page}
      initialSizeGuides={guides.page.guides}
      initialSizeGuidesHasMore={guides.page.hasMore}
      initialSizeGuidesNextOffset={guides.page.nextOffset}
      query={query}
    />
  );
}
