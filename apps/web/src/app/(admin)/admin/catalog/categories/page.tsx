import type { Metadata } from "next";
import Link from "next/link";
import { CategoryManager } from "@/features/catalog/category-manager";
import { getManagedCategories } from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Product categories",
  description: "Manage product categories in the Aaraj catalog.",
};

export default async function StaffCatalogCategoriesPage() {
  const result = await getManagedCategories();
  if ("kind" in result) {
    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an Aaraj administrator account to manage categories."
        : result.kind === "forbidden"
          ? "Only administrators can manage product categories."
          : "Categories could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary">
            AARAJ STAFF
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Product categories
          </h1>
          <p
            className={`mt-8 rounded-xl border p-5 ${result.kind === "forbidden" ? "border-destructive/30 bg-destructive/10 text-destructive" : result.kind === "unauthenticated" ? "border-border bg-card/70 text-secondary-foreground" : "border-warning/30 bg-warning/10 text-warning"}`}
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
      </main>
    );
  }

  return <CategoryManager initialCategories={result.categories} />;
}
