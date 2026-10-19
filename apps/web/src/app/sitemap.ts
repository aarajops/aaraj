import type { MetadataRoute } from "next";
import { getStorefrontCategoryHref } from "@aaraj/contracts";
import { getPublishedProducts } from "@/features/catalog/catalog-queries";
import { getStorefrontOrigin } from "@/lib/storefront-origin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;
const MAX_SITEMAP_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getStorefrontOrigin();
  const entries: MetadataRoute.Sitemap = [
    { url: new URL("/", origin).toString() },
  ];
  const seenCategorySlugs = new Set<string>();
  const seenSlugs = new Set<string>();
  let offset = 0;

  while (true) {
    const page = await getPublishedProducts({ limit: PAGE_SIZE, offset });
    if (!page) {
      throw new Error(
        "Published products could not be loaded for the sitemap.",
      );
    }

    if (offset === 0) {
      for (const category of page.filters.categories) {
        if (seenCategorySlugs.has(category.slug)) continue;
        if (entries.length >= MAX_SITEMAP_URLS) {
          throw new Error(
            "The storefront sitemap exceeded 50,000 URLs and must be split into multiple sitemap files.",
          );
        }
        seenCategorySlugs.add(category.slug);
        entries.push({
          url: new URL(
            getStorefrontCategoryHref(category.slug),
            origin,
          ).toString(),
        });
      }
    }

    for (const product of page.products) {
      if (seenSlugs.has(product.slug)) continue;
      if (entries.length >= MAX_SITEMAP_URLS) {
        throw new Error(
          "The storefront sitemap exceeded 50,000 URLs and must be split into multiple sitemap files.",
        );
      }
      seenSlugs.add(product.slug);
      entries.push({
        url: new URL(
          `/products/${encodeURIComponent(product.slug)}`,
          origin,
        ).toString(),
        lastModified: new Date(product.updatedAt),
        ...(product.images[0]
          ? {
              images: [
                new URL(product.images[0].detail.src, origin).toString(),
              ],
            }
          : {}),
      });
    }

    if (!page.hasMore) return entries;
    if (page.nextOffset === null || page.nextOffset <= offset) {
      throw new Error(
        "Published product pagination did not advance for sitemap generation.",
      );
    }
    offset = page.nextOffset;
  }
}
