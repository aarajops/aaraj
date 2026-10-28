import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCategoryIdSchema } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CategoryManager } from "@/features/catalog/category-manager";
import { getManagedCategories } from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Edit category",
  description: "Edit a product category in the Aaraj catalog.",
};

export default async function EditCatalogCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;
  if (!CatalogCategoryIdSchema.safeParse(categoryId).success) notFound();

  const result = await getManagedCategories();
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj administrator account to edit categories."
        : result.kind === "forbidden"
          ? "Only administrators can manage product categories."
          : "Categories could not be loaded. Please try again.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Edit category"
            description="Organize the storefront catalog."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href={
              result.kind === "unauthenticated"
                ? "/account"
                : "/admin/catalog/categories"
            }
          >
            {result.kind === "unauthenticated"
              ? "Go to your account"
              : "Back to categories"}
          </Link>
        </div>
      </>
    );
  }

  const category = result.categories.find(({ id }) => id === categoryId);
  if (!category) notFound();

  return (
    <CategoryManager
      key={category.id}
      view="edit"
      initialCategories={result.categories}
      initialCategory={category}
    />
  );
}
