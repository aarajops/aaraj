import "server-only";

import { headers } from "next/headers";
import {
  CatalogProductListQuerySchema,
  CatalogProductPageSchema,
  CatalogProductSchema,
  type CatalogProductListQuery,
  type CatalogProductPage,
  type CatalogProduct,
} from "@aaraj/contracts";

export type CatalogPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
};

const defaultCatalogQuery = CatalogProductListQuerySchema.parse({});

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

function apiBaseUrl(): string {
  return (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
}

export async function getPublishedProducts(
  query: CatalogProductListQuery,
): Promise<CatalogProductPage | null> {
  try {
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/products?${search}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const result = CatalogProductPageSchema.safeParse(await response.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function getPublishedProduct(
  slug: string,
): Promise<
  { product: CatalogProduct } | { kind: "not-found" | "unavailable" }
> {
  try {
    const response = await fetch(
      `${apiBaseUrl()}/api/catalog/products/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };

    const result = CatalogProductSchema.safeParse(await response.json());
    return result.success ? { product: result.data } : { kind: "unavailable" };
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
