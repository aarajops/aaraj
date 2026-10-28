import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CategoryManager } from "@/features/catalog/category-manager";
import {
  getManagedCategoryPage,
  parseCatalogCategoryTableQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Product categories",
  description: "Manage product categories in the Aaraj catalog.",
};

export default async function StaffCatalogCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = parseCatalogCategoryTableQuery(await searchParams);
  const result = await getManagedCategoryPage(query);
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj administrator account to manage categories."
        : result.kind === "forbidden"
          ? "Only administrators can manage product categories."
          : "Categories could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Product categories"
            description="Organize the storefront catalog."
          />
          <p
            className={`mt-6 rounded-xl border p-5 ${result.kind === "forbidden" ? "border-destructive/30 bg-destructive/10 text-destructive" : result.kind === "unauthenticated" ? "border-border bg-card/70 text-secondary-foreground" : "border-warning/30 bg-warning/10 text-warning"}`}
            role="alert"
          >
            {message}
          </p>
          {result.kind === "unauthenticated" && (
            <Link
              className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:bg-primary/80"
              href="/account"
            >
              Go to your account
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <CategoryManager
      key={JSON.stringify(query)}
      initialPage={result.page}
      query={query}
    />
  );
}
