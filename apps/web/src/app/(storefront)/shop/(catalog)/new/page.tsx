import type { Metadata } from "next";
import { PublishedProductListing } from "@/app/(storefront)/_components/published-product-listing";
import type { CatalogPageSearchParams } from "@/features/catalog/catalog-queries";
import { getStorefrontMetadataDefaults } from "@/features/storefront/storefront-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { settings, image } = await getStorefrontMetadataDefaults();
  const title = `${settings.siteName} | New arrivals`;
  const description = `Discover the latest arrivals from ${settings.siteName}.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/shop/new" },
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      title,
      description,
      url: "/shop/new",
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
    <PublishedProductListing
      pathname="/shop/new"
      searchParams={searchParams}
      sort="newest"
      title="New arrivals"
    />
  );
}
