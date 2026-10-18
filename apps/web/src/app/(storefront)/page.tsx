import { Suspense } from "react";
import type { Metadata } from "next";
import { STOREFRONT_BANNER_PLACEMENT_HOME_HERO } from "@aaraj/contracts";
import {
  CatalogLoading,
  PublishedProductListing,
} from "./_components/published-product-listing";
import { getPublicStorefrontBanners } from "@/features/storefront/storefront-banners";
import { StorefrontBanner } from "@/features/storefront/storefront-banner";
import { getStorefrontMetadataDefaults } from "@/features/storefront/storefront-metadata";
import type { CatalogPageSearchParams } from "@/features/catalog/catalog-queries";

export async function generateMetadata(): Promise<Metadata> {
  const { settings, title, description, image } =
    await getStorefrontMetadataDefaults();
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      title,
      description,
      url: "/",
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

export default function Home({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <StorefrontHero />
      </Suspense>
      <Suspense fallback={<CatalogLoading />}>
        <PublishedProductListing
          description="Explore products in the Aaraj catalog."
          pathname="/"
          searchParams={searchParams}
          showHomepageCategories
          title="Products"
        />
      </Suspense>
    </>
  );
}

async function StorefrontHero() {
  const banners = await getPublicStorefrontBanners(
    STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
  );
  return <StorefrontBanner banners={banners} />;
}
