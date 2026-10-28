import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedCategoryOptions,
  getManagedSizeGuides,
  parseCatalogPageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Create product",
  description: "Create a product in the Aaraj catalog.",
};

export default async function CreateCatalogProductPage() {
  const [guides, categoriesResult] = await Promise.all([
    getManagedSizeGuides({ limit: 100, offset: 0 }),
    getManagedCategoryOptions(),
  ]);
  if ("kind" in guides || "kind" in categoriesResult) {
    const loadError = "kind" in guides ? guides.kind : categoriesResult.kind;
    const message =
      loadError === "unauthenticated"
        ? "Sign in with an Aaraj staff account to create products."
        : loadError === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Product setup could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Create product"
            description="Create one product per style, then add its color and size options."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          {loadError === "unauthenticated" ? (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/account"
            >
              Go to your account
            </Link>
          ) : (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/admin/catalog"
            >
              Back to products
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <CatalogManager
      view="create"
      categoryOptions={categoriesResult.categories}
      initialSizeGuides={guides.page.guides}
      initialSizeGuidesHasMore={guides.page.hasMore}
      initialSizeGuidesNextOffset={guides.page.nextOffset}
      query={parseCatalogPageQuery({})}
    />
  );
}
