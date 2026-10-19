import { Suspense } from "react";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { CatalogCategorySlugSchema } from "@aaraj/contracts";
import {
  parsePublishedCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import { CatalogLoading } from "@/app/(storefront)/_components/catalog-loading";
import { PublishedProductListing } from "@/app/(storefront)/_components/published-product-listing";
import { getStorefrontMetadataDefaults } from "@/features/storefront/storefront-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { settings, image } = await getStorefrontMetadataDefaults();
  const title = `${settings.siteName} | Products`;
  const description = `Explore products in the ${settings.siteName} catalog.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/shop" },
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      title,
      description,
      url: "/shop",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function Products({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = await searchParams;
  const parsedQuery = parsePublishedCatalogPageQuery(query);
  const category = CatalogCategorySlugSchema.safeParse(parsedQuery?.category);

  if (category.success) {
    const filters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "category" || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) {
        filters.append(key, entry);
      }
    }
    const search = filters.toString();
    const href = `/shop/categories/${category.data}`;
    permanentRedirect(search ? `${href}?${search}` : href);
  }

  return (
    <Suspense fallback={<CatalogLoading />}>
      <PublishedProductListing
        pathname="/shop"
        searchParams={searchParams}
        title="Products"
      />
    </Suspense>
  );
}
