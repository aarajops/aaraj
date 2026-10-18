import { Suspense } from "react";
import type { Metadata } from "next";
import {
  CatalogLoading,
  PublishedProductListing,
} from "../_components/published-product-listing";
import type { CatalogPageSearchParams } from "@/features/catalog/catalog-queries";
import { getStorefrontMetadataDefaults } from "@/features/storefront/storefront-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { settings, image } = await getStorefrontMetadataDefaults();
  const title = `${settings.siteName} | New arrivals`;
  const description = `Discover the latest arrivals from ${settings.siteName}.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/new" },
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      title,
      description,
      url: "/new",
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

export default function NewArrivals({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  return (
    <Suspense fallback={<CatalogLoading />}>
      <PublishedProductListing
        description="Discover the latest additions to the Aaraj catalog."
        pathname="/new"
        searchParams={searchParams}
        sort="newest"
        title="New arrivals"
      />
    </Suspense>
  );
}
