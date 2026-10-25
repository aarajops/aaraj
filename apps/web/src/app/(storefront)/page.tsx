import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import {
  CatalogCategorySlugSchema,
  STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
} from "@aaraj/contracts";
import {
  getPublishedProductFilterOptions,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import { HomepageCategorySection } from "@/features/storefront/homepage-category-section";
import { getPublicStorefrontBanners } from "@/features/storefront/storefront-banners";
import { StorefrontBanner } from "@/features/storefront/storefront-banner";
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

  const [settings, productFilters] = await Promise.all([
    getPublicStorefrontSettings(),
    getPublishedProductFilterOptions(),
  ]);
  const homepageCategories = settings.homepageCategoriesEnabled
    ? (productFilters?.categories.filter(({ id }) =>
        settings.homepageCategoryIds.includes(id),
      ) ?? [])
    : [];

  return (
    <>
      <Suspense fallback={null}>
        <StorefrontHero />
      </Suspense>
      <main className="bg-background px-5 py-14 text-foreground sm:py-20">
        <div className="container mx-auto">
          <HomepageCategorySection categories={homepageCategories} />
          <div className="flex justify-center">
            <Link
              className="rounded-lg border border-input px-4 py-2.5 text-sm font-medium text-foreground hover:border-ring"
              href="/shop"
            >
              View all products
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

async function StorefrontHero() {
  const banners = await getPublicStorefrontBanners(
    STOREFRONT_BANNER_PLACEMENT_HOME_HERO,
  );
  return <StorefrontBanner banners={banners} />;
}
