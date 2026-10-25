import "server-only";

import { headers } from "next/headers";
import {
  API_V1_BASE_PATH,
  PathaoManagementBookingSummariesSchema,
  PathaoManagementIssuesQuerySchema,
  PathaoManagementIssuesSchema,
  type PathaoManagementIssuesQuery,
  type PathaoManagementIssues,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export type PathaoIssuesPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
};

export type StaffPathaoResult<T> =
  { value: T } | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export function parsePathaoIssuesPageQuery(
  searchParams: PathaoIssuesPageSearchParams,
): PathaoManagementIssuesQuery {
  if (Array.isArray(searchParams.limit) || Array.isArray(searchParams.offset)) {
    return PathaoManagementIssuesQuerySchema.parse({});
  }

  const result = PathaoManagementIssuesQuerySchema.safeParse(searchParams);
  return result.success
    ? result.data
    : PathaoManagementIssuesQuerySchema.parse({});
}

async function sessionHeaders(): Promise<HeadersInit> {
  const cookie = (await headers()).get("cookie");
  return cookie ? { cookie } : {};
}

export async function getPathaoBookingSummariesForOrders(
  orderIds: readonly string[],
) {
  if (orderIds.length === 0) return [];

  try {
    const search = new URLSearchParams({ orderIds: orderIds.join(",") });
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/delivery/pathao/manage/orders?${search}`,
      { headers: await sessionHeaders(), cache: "no-store" },
    );
    if (!response.ok) return null;
    const result = PathaoManagementBookingSummariesSchema.safeParse(
      await response.json(),
    );
    if (!result.success || result.data.length !== orderIds.length) return null;
    const summariesByOrderId = new Map(
      result.data.map((summary) => [summary.orderId, summary]),
    );
    if (
      summariesByOrderId.size !== orderIds.length ||
      orderIds.some((orderId) => !summariesByOrderId.has(orderId))
    ) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

export async function getPathaoManagementIssuesForPage(
  query: PathaoManagementIssuesQuery,
): Promise<StaffPathaoResult<PathaoManagementIssues>> {
  try {
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/delivery/pathao/manage/issues?${search}`,
      { headers: await sessionHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const result = PathaoManagementIssuesSchema.safeParse(
      await response.json(),
    );
    return result.success ? { value: result.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
