import "server-only";

import { headers } from "next/headers";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  API_V1_BASE_PATH,
  CatalogProductListQuerySchema,
  CatalogProductDetailSchema,
  CatalogManagedProductDetailSchema,
  CatalogProductIdSchema,
  CatalogProductSlugSchema,
  CatalogProductPageSchema,
  CatalogPublishedProductListQuerySchema,
  CatalogPublishedProductPageSchema,
  CatalogCategoryListSchema,
  CatalogCategoryOptionsSchema,
  CatalogSizeGuideListQuerySchema,
  CatalogSizeGuidePageSchema,
  CatalogSizeGuideSchema,
  type CatalogProductListQuery,
  type CatalogProductPage,
  type CatalogPublishedProductListQuery,
  type CatalogPublishedProductPage,
  type CatalogProductDetail,
  type CatalogManagedProductDetail,
  type CatalogCategoryOption,
  type CatalogSizeGuide,
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
  search?: string | string[];
  status?: string | string[];
  categoryId?: string | string[];
  fit?: string | string[];
  measurementBasis?: string | string[];
  kind?: string | string[];
};

const defaultCatalogQuery = CatalogProductListQuerySchema.parse({});
const defaultSizeGuideQuery = CatalogSizeGuideListQuerySchema.parse({});
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
    search:
      typeof searchParams.search === "string" ? searchParams.search : undefined,
    status:
      typeof searchParams.status === "string" ? searchParams.status : undefined,
    categoryId:
      typeof searchParams.categoryId === "string"
        ? searchParams.categoryId
        : undefined,
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
): CatalogSizeGuideListQuery {
  const result = CatalogSizeGuideListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
    search:
      typeof searchParams.search === "string" ? searchParams.search : undefined,
    categoryId:
      typeof searchParams.categoryId === "string"
        ? searchParams.categoryId
        : undefined,
    fit: typeof searchParams.fit === "string" ? searchParams.fit : undefined,
    measurementBasis:
      typeof searchParams.measurementBasis === "string"
        ? searchParams.measurementBasis
        : undefined,
  });
  return result.success ? result.data : defaultSizeGuideQuery;
}

export function parseCatalogCategoryTableQuery(
  searchParams: CatalogPageSearchParams,
) {
  const statusParam: "active" | "inactive" | undefined =
    searchParams.status === "active"
      ? "active"
      : searchParams.status === "inactive"
        ? "inactive"
        : undefined;
  const kindParam: "parent" | "leaf" | undefined =
    searchParams.kind === "parent"
      ? "parent"
      : searchParams.kind === "leaf"
        ? "leaf"
        : undefined;
  const result = CatalogProductListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
    search:
      typeof searchParams.search === "string" ? searchParams.search : undefined,
  });
  return {
    limit: result.success ? result.data.limit : defaultCatalogQuery.limit,
    offset: result.success ? result.data.offset : 0,
    search: result.success ? result.data.search : undefined,
    status: statusParam,
    kind: kindParam,
  };
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
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/products?${search}`,
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
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/products/${encodeURIComponent(slug)}`,
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
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/categories/manage`,
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

export async function getPublicCatalogCategories(): Promise<
  CatalogCategoryOption[]
> {
  try {
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/categories`,
      {
        cache: "no-store",
      },
    );
    if (!response.ok) return [];

    const result = CatalogCategoryOptionsSchema.safeParse(
      await response.json(),
    );
    return result.success ? result.data.categories : [];
  } catch {
    return [];
  }
}

export async function getManagedSizeGuides(
  query: CatalogSizeGuideListQuery,
): Promise<ManagedSizeGuidesResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    if (query.categoryId) search.set("categoryId", query.categoryId);
    if (query.fit) search.set("fit", query.fit);
    if (query.measurementBasis) {
      search.set("measurementBasis", query.measurementBasis);
    }
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/size-guides/manage?${search}`,
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
    if (query.search) search.set("search", query.search);
    if (query.categoryId) search.set("categoryId", query.categoryId);
    if (query.status) search.set("status", query.status);
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/products/manage?${search}`,
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

export type ManagedProductResult =
  | { product: CatalogManagedProductDetail }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

export async function getManagedProduct(
  productId: string,
): Promise<ManagedProductResult> {
  if (!CatalogProductIdSchema.safeParse(productId).success) {
    return { kind: "not-found" };
  }

  try {
    const cookie = (await headers()).get("cookie");
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/products/manage/${encodeURIComponent(productId)}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogManagedProductDetailSchema.safeParse(
      await response.json(),
    );
    return result.success ? { product: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type ManagedSizeGuideResult =
  | { guide: CatalogSizeGuide }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

export async function getManagedSizeGuide(
  guideId: string,
): Promise<ManagedSizeGuideResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/catalog/size-guides/manage/${encodeURIComponent(guideId)}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404 || response.status === 400) {
      return { kind: "not-found" };
    }
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogSizeGuideSchema.safeParse(await response.json());
    return result.success ? { guide: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
