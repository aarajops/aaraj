import "server-only";

import { headers } from "next/headers";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  CatalogProductListQuerySchema,
  CatalogProductDetailSchema,
  CatalogProductSlugSchema,
  CatalogProductPageSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogPublishedProductPageSchema,
  CatalogCategoryListSchema,
  CatalogSizeGuideListQuerySchema,
  CatalogSizeGuidePageSchema,
  type CatalogProductListQuery,
  type CatalogProductPage,
  type CatalogPublishedProductListQuery,
  type CatalogPublishedProductPage,
  type CatalogProductDetail,
  type CatalogSizeGuideListQuery,
  type CatalogSizeGuidePage,
} from "@aaraj/contracts";

export type CatalogPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  audience?: string | string[];
  category?: string | string[];
  color?: string | string[];
  size?: string | string[];
};

const defaultCatalogQuery = CatalogProductListQuerySchema.parse({});
const defaultPublishedCatalogQuery =
  CatalogPublishedProductListQuerySchema.parse({});

export function parseCatalogPageQuery(
  searchParams: CatalogPageSearchParams,
): CatalogProductListQuery {
  const result = CatalogProductListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
  });
  return result.success ? result.data : defaultCatalogQuery;
}

export function parsePublishedCatalogPageQuery(
  searchParams: CatalogPageSearchParams,
): CatalogPublishedProductListQuery {
  const searchValues = [
    searchParams.limit,
    searchParams.offset,
    searchParams.audience,
    searchParams.category,
    searchParams.color,
    searchParams.size,
  ];
  if (searchValues.some(Array.isArray)) return defaultPublishedCatalogQuery;

  const result = CatalogPublishedProductListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
    audience:
      typeof searchParams.audience === "string"
        ? searchParams.audience
        : undefined,
    category:
      typeof searchParams.category === "string"
        ? searchParams.category
        : undefined,
    color:
      typeof searchParams.color === "string" ? searchParams.color : undefined,
    size: typeof searchParams.size === "string" ? searchParams.size : undefined,
  });
  return result.success ? result.data : defaultPublishedCatalogQuery;
}

export function parseCatalogSizeGuidePageQuery(
  searchParams: CatalogPageSearchParams,
): Pick<CatalogSizeGuideListQuery, "limit" | "offset"> {
  const result = CatalogSizeGuideListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
  });
  return result.success
    ? { limit: result.data.limit, offset: result.data.offset }
    : { limit: defaultCatalogQuery.limit, offset: 0 };
}

function apiBaseUrl(): string {
  return getApiInternalUrl();
}

export async function getPublishedProducts(
  query: CatalogPublishedProductListQuery,
): Promise<CatalogPublishedProductPage | null> {
  try {
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.audience) search.set("audience", query.audience);
    if (query.category) search.set("category", query.category);
    if (query.color) search.set("color", query.color);
    if (query.size) search.set("size", query.size);
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/products?${search}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const result = CatalogPublishedProductPageSchema.safeParse(
      await response.json(),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function getPublishedProduct(
  slug: string,
): Promise<
  { product: CatalogProductDetail } | { kind: "not-found" | "unavailable" }
> {
  if (!CatalogProductSlugSchema.safeParse(slug).success) {
    return { kind: "not-found" };
  }

  try {
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/products/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogProductDetailSchema.safeParse(await response.json());
    return result.success ? { product: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type ManagedSizeGuidesResult =
  | { page: CatalogSizeGuidePage }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedCategories() {
  try {
    const cookie = (await headers()).get("cookie");
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/categories/manage`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" as const };
    if (response.status === 403) return { kind: "forbidden" as const };
    if (!response.ok) return { kind: "unavailable" as const };

    const result = CatalogCategoryListSchema.safeParse(await response.json());
    return result.success
      ? { categories: result.data.categories }
      : { kind: "unavailable" as const };
  } catch {
    return { kind: "unavailable" as const };
  }
}

export async function getManagedSizeGuides(
  query: Pick<CatalogSizeGuideListQuery, "limit" | "offset">,
): Promise<ManagedSizeGuidesResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/size-guides/manage?${search}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogSizeGuidePageSchema.safeParse(await response.json());
    return result.success ? { page: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type ManagedProductsResult =
  | { page: CatalogProductPage }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedProducts(
  query: CatalogProductListQuery,
): Promise<ManagedProductsResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/products/manage?${search}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogProductPageSchema.safeParse(await response.json());
    return result.success ? { page: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
