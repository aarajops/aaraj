import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedCategoryOptions,
  getManagedProducts,
  parseCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Products",
  description: "Manage product listings and variants.",
};

export default async function StaffCatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogPageQuery(await searchParams);
  const [result, categoriesResult] = await Promise.all([
    getManagedProducts(query),
    getManagedCategoryOptions(),
  ]);

  if ("kind" in result || "kind" in categoriesResult) {
    const loadError = "kind" in result ? result.kind : categoriesResult.kind;
    const isUnauthenticated = loadError === "unauthenticated";
    const isForbidden = loadError === "forbidden";
    return (
      <>
        <div>
          <AdminPageHeader
            title="Products"
            description="Manage product listings and variants."
          />
          <section
            className={`mt-6 rounded-2xl border p-7 ${isForbidden ? "border-destructive/30 bg-destructive/10" : isUnauthenticated ? "border-border bg-card/70" : "border-warning/30 bg-warning/10"}`}
          >
            <h2 className="text-xl font-semibold">
              {loadError === "unauthenticated"
                ? "Sign in to continue"
                : loadError === "forbidden"
                  ? "Staff access required"
                  : "Catalog unavailable"}
            </h2>
            <p className="mt-2 text-secondary-foreground">
              {loadError === "unauthenticated"
                ? "Sign in with an Aaraj staff account to manage products."
                : loadError === "forbidden"
                  ? "Your account does not have permission to manage the catalog."
                  : "Catalog management could not be loaded. Please try again."}
            </p>
            {loadError === "unauthenticated" ? (
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
      </>
    );
  }
  return (
    <CatalogManager
      key={JSON.stringify(query)}
      initialPage={result.page}
      categoryOptions={categoriesResult.categories}
      query={query}
    />
  );
}
