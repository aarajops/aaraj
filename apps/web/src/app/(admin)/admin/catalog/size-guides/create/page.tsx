import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { SizeGuideManager } from "@/features/catalog/size-guide-manager";
import {
  getManagedCategoryOptions,
  getManagedSizeGuides,
  parseCatalogSizeGuidePageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Create size guide",
  description: "Create a reusable product size guide in the Aaraj catalog.",
};

export default async function CreateSizeGuidePage() {
  const query = parseCatalogSizeGuidePageQuery({});
  const [result, categoriesResult] = await Promise.all([
    getManagedSizeGuides(query),
    getManagedCategoryOptions(),
  ]);
  if ("kind" in result || "kind" in categoriesResult) {
    const loadError = "kind" in result ? result.kind : categoriesResult.kind;
    const message =
      loadError === "unauthenticated"
        ? "Sign in with an Aaraj staff account to create size guides."
        : loadError === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Size guide setup could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Create size guide"
            description="Define sizing by category and fit."
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
              href="/admin/catalog/size-guides"
            >
              Back to size guides
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <SizeGuideManager
      view="create"
      initialPage={result.page}
      categoryOptions={categoriesResult.categories}
      query={query}
    />
  );
}
