import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedProduct,
  getManagedSizeGuides,
  parseCatalogPageQuery,
} from "@/features/catalog/catalog-queries";

export const metadata: Metadata = {
  title: "Edit product",
  description: "Edit a product in the Aaraj catalog.",
};

export default async function EditCatalogProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const [product, guides] = await Promise.all([
    getManagedProduct(productId),
    getManagedSizeGuides({ limit: 100, offset: 0 }),
  ]);

  if ("kind" in product) {
    if (product.kind === "not-found") notFound();
    const message =
      product.kind === "unauthenticated"
        ? "Sign in with an Aaraj staff account to edit products."
        : product.kind === "forbidden"
          ? "Your account does not have permission to manage the catalog."
          : "Product details could not be loaded. Please try again.";

    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Edit product
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
              product.kind === "unauthenticated" ? "/account" : "/admin/catalog"
            }
          >
            {product.kind === "unauthenticated"
              ? "Go to your account"
              : "Back to products"}
          </Link>
        </div>
      </main>
    );
  }

  if ("kind" in guides) {
    return (
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight">
            Edit product
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Size guides could not be loaded. Please try again.
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href="/admin/catalog"
          >
            Back to products
          </Link>
        </div>
      </main>
    );
  }

  return (
    <CatalogManager
      view="edit"
      initialProduct={product.product}
      initialSizeGuides={guides.page.guides}
      initialSizeGuidesHasMore={guides.page.hasMore}
      initialSizeGuidesNextOffset={guides.page.nextOffset}
      query={parseCatalogPageQuery({})}
    />
  );
}
