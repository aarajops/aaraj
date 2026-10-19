import { Suspense } from "react";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import {
  CatalogCategorySlugSchema,
  getStorefrontCategoryHref,
  STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
} from "@aaraj/contracts";
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<CatalogPageSearchParams>;
}) {
  const query = await searchParams;
  const categorySlug = CatalogCategorySlugSchema.safeParse(query.category);
  if (categorySlug.success) {
    const filters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "category" || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) {
        filters.append(key, entry);
      }
    }
    const search = filters.toString();
    const href = getStorefrontCategoryHref(categorySlug.data);
    permanentRedirect(search ? `${href}?${search}` : href);
  }

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
