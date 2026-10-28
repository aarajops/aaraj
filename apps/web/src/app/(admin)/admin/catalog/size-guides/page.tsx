import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
  getManagedCategoryOptions,
  getManagedSizeGuides,
  parseCatalogSizeGuidePageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Size guides",
  description: "Manage reusable product size guides in the Aaraj catalog.",
};

export default async function StaffSizeGuidesPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogSizeGuidePageQuery(await searchParams);
  const [result, categoriesResult] = await Promise.all([
    getManagedSizeGuides(query),
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
            title="Size guides"
            description="Define sizing by category and fit."
          />
          <section className="mt-6 rounded-2xl border border-border bg-card/70 p-7">
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
      </>
    );
  }

  return (
    <SizeGuideManager
      key={JSON.stringify(query)}
      initialPage={result.page}
      categoryOptions={categoriesResult.categories}
      query={query}
    />
  );
}
