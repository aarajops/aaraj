import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedProducts,
  parseCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import Link from "next/link";

export default async function StaffCatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogPageQuery(await searchParams);
  const result = await getManagedProducts(query);

  if ("kind" in result) {
    const isUnauthenticated = result.kind === "unauthenticated";
    const isForbidden = result.kind === "forbidden";
    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-zinc-950 px-5 py-12 text-zinc-100 sm:py-16">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-emerald-300">
            AARAJ STAFF
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Catalog management
          </h1>
          <section
            className={`mt-8 rounded-2xl border p-7 ${isForbidden ? "border-red-900 bg-red-950/40" : isUnauthenticated ? "border-zinc-800 bg-zinc-900/70" : "border-amber-900/70 bg-amber-950/30"}`}
          >
            <h2 className="text-xl font-semibold">
              {isUnauthenticated
                ? "Sign in to continue"
                : isForbidden
                  ? "Staff access required"
                  : "Catalog unavailable"}
            </h2>
            <p className="mt-2 text-zinc-300">
              {isUnauthenticated
                ? "Sign in with an Aaraj staff account to manage products."
                : isForbidden
                  ? "Your account does not have permission to manage the catalog."
                  : "Catalog management could not be loaded. Please try again."}
            </p>
            {isUnauthenticated ? (
              <Link
                className="mt-5 inline-flex rounded-lg bg-emerald-300 px-4 py-2.5 font-semibold text-zinc-950 hover:bg-emerald-200"
                href="/account"
              >
                Go to your account
              </Link>
            ) : (
              <Link
                className="mt-5 inline-flex rounded-lg border border-zinc-600 px-4 py-2.5 font-medium text-zinc-100 hover:border-zinc-400"
                href="/staff/catalog"
              >
                Try again
              </Link>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <CatalogManager
      key={`${query.limit}:${query.offset}`}
      initialPage={result.page}
      query={query}
    />
  );
}
