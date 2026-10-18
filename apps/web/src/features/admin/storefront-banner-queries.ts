import "server-only";

import { headers } from "next/headers";
import {
  API_V1_BASE_PATH,
  StorefrontBannerAssetPageSchema,
  StorefrontBannerListQuerySchema,
  StorefrontBannerPageSchema,
  StorefrontBannerSchema,
  type StorefrontBanner,
  type StorefrontBannerAssetPage,
  type StorefrontBannerListQuery,
  type StorefrontBannerPage,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export type StorefrontBannerSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
  status?: string | string[];
};

const defaultQuery = StorefrontBannerListQuerySchema.parse({});

export function parseStorefrontBannerListQuery(
  searchParams: StorefrontBannerSearchParams,
): StorefrontBannerListQuery {
  const result = StorefrontBannerListQuerySchema.safeParse({
    limit:
      typeof searchParams.limit === "string" ? searchParams.limit : undefined,
    offset:
      typeof searchParams.offset === "string" ? searchParams.offset : undefined,
    search:
      typeof searchParams.search === "string" ? searchParams.search : undefined,
    status:
      typeof searchParams.status === "string" ? searchParams.status : undefined,
  });
  return result.success ? result.data : defaultQuery;
}

export type ManagedStorefrontBannersResult =
  | { page: StorefrontBannerPage }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedStorefrontBanners(
  query: StorefrontBannerListQuery,
): Promise<ManagedStorefrontBannersResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    if (query.status) search.set("status", query.status);
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/storefront/manage/banners?${search}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const result = StorefrontBannerPageSchema.safeParse(await response.json());
    return result.success ? { page: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type ManagedBannerAssetsResult =
  | { page: StorefrontBannerAssetPage }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedBannerAssets(): Promise<ManagedBannerAssetsResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/storefront/manage/banner-assets`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const result = StorefrontBannerAssetPageSchema.safeParse(
      await response.json(),
    );
    return result.success ? { page: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type ManagedStorefrontBannerResult =
  | { banner: StorefrontBanner }
  | {
      kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable";
    };

export async function getManagedStorefrontBanner(
  bannerId: string,
): Promise<ManagedStorefrontBannerResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/storefront/manage/banners/${encodeURIComponent(bannerId)}`,
      {
        ...(cookie ? { headers: { cookie } } : {}),
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };
    const result = StorefrontBannerSchema.safeParse(await response.json());
    return result.success ? { banner: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
