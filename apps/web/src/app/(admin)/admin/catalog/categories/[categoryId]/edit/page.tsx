import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCategoryIdSchema } from "@aaraj/contracts";
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
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Edit category
          </h1>
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
      </main>
    );
  }

  const category = result.categories.find(({ id }) => id === categoryId);
  if (!category) notFound();

  return (
    <CategoryManager
      view="edit"
      initialCategories={result.categories}
      initialCategory={category}
    />
  );
}
