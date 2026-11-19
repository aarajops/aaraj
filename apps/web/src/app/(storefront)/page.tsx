import { Suspense } from "react";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import {
  CatalogAudienceSchema,
  CatalogCategorySlugSchema,
  CatalogPublishedProductListQuerySchema,
  STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
} from "@aaraj/contracts";
import {
  getPublishedProducts,
  getPublishedProductFilterOptions,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import { HomepageCategorySection } from "@/features/storefront/homepage-category-section";
import { resolveHomepageCategories } from "@/features/storefront/homepage-categories";
import { NewArrivalsSection } from "@/features/storefront/new-arrivals-section";
import { getPublicStorefrontBanners } from "@/features/storefront/storefront-banners";
import { StorefrontBanner } from "@/features/storefront/storefront-banner";
import { HomepageSnowfall } from "@/features/storefront/homepage-snowfall";
import { getStorefrontMetadataDefaults } from "@/features/storefront/storefront-metadata";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

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
    const href = `/shop/categories/${categorySlug.data}`;
    permanentRedirect(search ? `${href}?${search}` : href);
  }

  const audienceResult =
    typeof query.audience === "string"
      ? CatalogAudienceSchema.safeParse(query.audience)
      : null;
  const audience = audienceResult?.success ? audienceResult.data : "unisex";
  const settingsPromise = getPublicStorefrontSettings();
  const [settings, newArrivals] = await Promise.all([
    settingsPromise,
    getPublishedProducts(
      CatalogPublishedProductListQuerySchema.parse({
        limit: 10,
        offset: 0,
        sort: "newest",
        audience,
      }),
    ),
  ]);
  let publishedCategories = newArrivals?.filters.categories ?? null;
  if (
    settings.homepageCategoriesEnabled &&
    settings.homepageCategoryIds.length > 0 &&
    publishedCategories === null
  ) {
    publishedCategories =
      (await getPublishedProductFilterOptions())?.categories ?? [];
  }
  const homepageCategories = resolveHomepageCategories(
    settings.homepageCategoriesEnabled,
    settings.homepageCategoryIds,
    publishedCategories ?? [],
  );

  return (
    <>
      <div className="relative isolate overflow-hidden">
        <Suspense fallback={null}>
          <StorefrontHero />
        </Suspense>
      </div>
      <main className="bg-background px-5 py-14 text-foreground sm:py-20">
        <div className="container mx-auto">
          <HomepageCategorySection categories={homepageCategories} />
          <NewArrivalsSection
            audience={audience}
            products={newArrivals?.products ?? []}
            unavailable={newArrivals === null}
          />
        </div>
      </main>
      <HomepageSnowfall />
    </>
  );
}

async function StorefrontHero() {
  const banners = await getPublicStorefrontBanners(
    STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
  );
  return <StorefrontBanner banners={banners} />;
}
