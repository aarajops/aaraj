import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CatalogCategorySlugSchema,
  DEFAULT_PUBLIC_CATALOG_PAGE_SIZE,
  getStorefrontCategoryHref,
} from "@aaraj/contracts";
import {
  CatalogLoading,
  PublishedProductListing,
} from "../../_components/published-product-listing";
import {
  getStorefrontCategoryBySlug,
  parsePublishedCatalogPageQuery,
  type CatalogPageSearchParams,
} from "@/features/catalog/catalog-queries";
import {
  getStorefrontMetadataDefaults,
  getStorefrontShareImage,
} from "@/features/storefront/storefront-metadata";

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<CatalogPageSearchParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const parsedSlug = CatalogCategorySlugSchema.safeParse(slug);
  if (!parsedSlug.success) notFound();

  const [result, defaults] = await Promise.all([
    getStorefrontCategoryBySlug(parsedSlug.data),
    getStorefrontMetadataDefaults(),
  ]);
  if (result.kind === "not-found") notFound();

  const category = result.kind === "found" ? result.category : null;
  const title = category
    ? `${category.name} | ${defaults.settings.siteName}`
    : `${slug.replaceAll("-", " ")} | ${defaults.settings.siteName}`;
  const description = category
    ? `Browse ${category.name} products from ${defaults.settings.siteName}.`
    : defaults.description;
  const canonical = getCategoryCanonical(parsedSlug.data, query);
  const image = category?.image
    ? {
        url: category.image.src,
        width: category.image.width,
        height: category.image.height,
        alt: `${category.name} category`,
      }
    : getStorefrontShareImage(defaults.settings);
  const hasFilters = [
    "audience",
    "category",
    "color",
    "size",
    "sort",
    "search",
  ].some((key) => {
    const value = query[key as keyof CatalogPageSearchParams];
    return Array.isArray(value) ? value.some(Boolean) : Boolean(value);
  });
  const hasInvalidQuery = parsePublishedCatalogPageQuery(query) === null;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    ...(hasFilters ||
    hasInvalidQuery ||
    result.kind === "unavailable" ||
    result.publishedProductCount === 0
      ? { robots: { index: false, follow: true } }
      : {}),
    openGraph: {
      type: "website",
      siteName: defaults.settings.siteName,
      title,
      description,
      url: canonical,
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

export default async function StorefrontCategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const parsedSlug = CatalogCategorySlugSchema.safeParse(slug);
  if (!parsedSlug.success) notFound();

  const result = await getStorefrontCategoryBySlug(parsedSlug.data);
  if (result.kind === "not-found") notFound();

  const name =
    result.kind === "found" ? result.category.name : slug.replaceAll("-", " ");

  return (
    <Suspense fallback={<CatalogLoading />}>
      <PublishedProductListing
        categorySlug={parsedSlug.data}
        description={`Browse ${name} products from the catalog.`}
        pathname={getStorefrontCategoryHref(parsedSlug.data)}
        searchParams={searchParams}
        title={name}
      />
    </Suspense>
  );
}

function getCategoryCanonical(
  slug: string,
  searchParams: CatalogPageSearchParams,
): string {
  const pathname = getStorefrontCategoryHref(slug);
  const offset =
    typeof searchParams.offset === "string" ? Number(searchParams.offset) : 0;
  if (!Number.isSafeInteger(offset) || offset <= 0) return pathname;

  const limit =
    typeof searchParams.limit === "string"
      ? Number(searchParams.limit)
      : DEFAULT_PUBLIC_CATALOG_PAGE_SIZE;
  const pagination = new URLSearchParams();
  if (limit !== DEFAULT_PUBLIC_CATALOG_PAGE_SIZE) {
    pagination.set("limit", String(limit));
  }
  pagination.set("offset", String(offset));
  return `${pathname}?${pagination}`;
}
