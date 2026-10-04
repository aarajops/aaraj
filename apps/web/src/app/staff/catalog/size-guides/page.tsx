import Link from "next/link";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
  getManagedSizeGuides,
  parseCatalogSizeGuidePageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";

export default async function StaffSizeGuidesPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogSizeGuidePageQuery(await searchParams);
  const result = await getManagedSizeGuides(query);
  if ("kind" in result) {
    const isUnauthenticated = result.kind === "unauthenticated";
    const isForbidden = result.kind === "forbidden";
    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <Link
            className="text-sm text-primary hover:text-primary/80"
            href="/staff/catalog"
          >
            ← Back to catalog management
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Size guides
          </h1>
          <section className="mt-8 rounded-2xl border border-border bg-card/70 p-7">
            <h2 className="text-xl font-semibold">
              {isUnauthenticated
                ? "Sign in to continue"
                : isForbidden
                  ? "Staff access required"
                  : "Size guides unavailable"}
            </h2>
            <p className="mt-2 text-secondary-foreground">
              {isUnauthenticated
                ? "Sign in with an Aaraj staff account to manage size guides."
                : isForbidden
                  ? "Your account does not have permission to manage the catalog."
                  : "Size guides could not be loaded. Please try again."}
            </p>
            {isUnauthenticated && (
              <Link
                className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
                href="/account"
              >
                Go to your account
              </Link>
            )}
          </section>
        </div>
      </main>
    );
  }

  return <SizeGuideManager initialPage={result.page} query={query} />;
}
