import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CategoryManager } from "@/features/catalog/category-manager";
import { getManagedCategories } from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Create category",
  description: "Create a product category in the Aaraj catalog.",
};

export default async function CreateCatalogCategoryPage() {
  const result = await getManagedCategories();
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj administrator account to create categories."
        : result.kind === "forbidden"
          ? "Only administrators can manage product categories."
          : "Categories could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Create category"
            description="Organize the storefront catalog."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          {result.kind === "unauthenticated" ? (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/account"
            >
              Go to your account
            </Link>
          ) : (
            <Link
              className="mt-5 inline-flex text-primary underline"
              href="/admin/catalog/categories"
            >
              Back to categories
            </Link>
          )}
        </div>
      </>
    );
  }

  return (
    <CategoryManager view="create" initialCategories={result.categories} />
  );
}
