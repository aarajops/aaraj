import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CatalogManager } from "@/features/catalog/catalog-manager";
import {
  getManagedCategoryOptions,
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
  const [product, guides, categoriesResult] = await Promise.all([
    getManagedProduct(productId),
    getManagedSizeGuides({ limit: 100, offset: 0 }),
    getManagedCategoryOptions(),
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
      <>
        <div>
          <AdminPageHeader
            title="Edit product"
            description="Update product details, variants, and storefront visibility."
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
              product.kind === "unauthenticated" ? "/account" : "/admin/catalog"
            }
          >
            {product.kind === "unauthenticated"
              ? "Go to your account"
              : "Back to products"}
          </Link>
        </div>
      </>
    );
  }

  if ("kind" in guides) {
    return (
      <>
        <div>
          <AdminPageHeader
            title="Edit product"
            description="Update product details, variants, and storefront visibility."
          />
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
      </>
    );
  }

  if ("kind" in categoriesResult) {
    return (
      <>
        <div>
          <AdminPageHeader
            title="Edit product"
            description="Update product details, variants, and storefront visibility."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Categories could not be loaded. Please try again.
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href="/admin/catalog"
          >
            Back to products
          </Link>
        </div>
      </>
    );
  }

  return (
    <CatalogManager
      key={product.product.id}
      view="edit"
      initialProduct={product.product}
      categoryOptions={categoriesResult.categories}
      initialSizeGuides={guides.page.guides}
      initialSizeGuidesHasMore={guides.page.hasMore}
      initialSizeGuidesNextOffset={guides.page.nextOffset}
      query={parseCatalogPageQuery({})}
    />
  );
}
