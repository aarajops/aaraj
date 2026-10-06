import "server-only";

import { headers } from "next/headers";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  API_V1_BASE_PATH,
  InventoryListQuerySchema,
  InventoryVariantPageSchema,
  InventoryVariantSchema,
  type InventoryListQuery,
  type InventoryVariant,
  type InventoryVariantPage,
} from "@aaraj/contracts";

export type InventoryPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
};

const defaultQuery = InventoryListQuerySchema.parse({});

export function parseInventoryPageQuery(
  searchParams: InventoryPageSearchParams,
): InventoryListQuery {
  if (
    Array.isArray(searchParams.limit) ||
    Array.isArray(searchParams.offset) ||
    Array.isArray(searchParams.search)
  ) {
    return defaultQuery;
  }

  const result = InventoryListQuerySchema.safeParse({
    limit: searchParams.limit,
    offset: searchParams.offset,
    search: searchParams.search,
  });
  return result.success ? result.data : defaultQuery;
}

type ManagedInventoryResult =
  | { page: InventoryVariantPage }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

type ManagedInventoryVariantResult =
  | { variant: InventoryVariant }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

function apiBaseUrl(): string {
  return getApiInternalUrl();
}

async function requestHeaders(): Promise<HeadersInit> {
  const cookie = (await headers()).get("cookie");
  return cookie ? { cookie } : {};
}

export async function getManagedInventory(
  query: InventoryListQuery,
): Promise<ManagedInventoryResult> {
  try {
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/inventory/manage?${search}`,
      { headers: await requestHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };

    const result = InventoryVariantPageSchema.safeParse(await response.json());
    return result.success ? { page: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getManagedInventoryVariant(
  variantId: string,
): Promise<ManagedInventoryVariantResult> {
  try {
    const response = await fetch(
      `${apiBaseUrl()}${API_V1_BASE_PATH}/inventory/manage/${encodeURIComponent(variantId)}`,
      { headers: await requestHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };

    const result = InventoryVariantSchema.safeParse(await response.json());
    return result.success ? { variant: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
