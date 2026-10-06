import type { Metadata } from "next";
import Link from "next/link";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedSizeGuides,
  parseCatalogPageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Create product",
  description: "Create a product in the Aaraj catalog.",
};

export default async function CreateCatalogProductPage() {
  const guides = await getManagedSizeGuides({ limit: 100, offset: 0 });
  if ("kind" in guides) {
    const message =
      guides.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to create products."
        : guides.kind === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Product setup could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Create product
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            {message}
          </p>
          {guides.kind === "unauthenticated" ? (
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
      </main>
    );
  }

  return (
    <CatalogManager
      view="create"
      initialSizeGuides={guides.page.guides}
      initialSizeGuidesHasMore={guides.page.hasMore}
      initialSizeGuidesNextOffset={guides.page.nextOffset}
      query={parseCatalogPageQuery({})}
    />
  );
}
