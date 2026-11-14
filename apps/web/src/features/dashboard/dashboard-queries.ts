import "server-only";

import { headers } from "next/headers";
import {
  API_V1_BASE_PATH,
  DashboardOverviewQuerySchema,
  DashboardOverviewSchema,
  type DashboardOverview,
  type DashboardRange,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export type DashboardResult =
  | { value: DashboardOverview }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export function parseDashboardRange(
  value: string | string[] | undefined,
): DashboardRange {
  if (Array.isArray(value)) return "30d";
  const parsed = DashboardOverviewQuerySchema.safeParse({ range: value });
  return parsed.success ? parsed.data.range : "30d";
}

export async function getDashboardOverview(
  range: DashboardRange,
): Promise<DashboardResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const requestHeaders = new Headers();
    if (cookie) requestHeaders.set("cookie", cookie);
    const query = new URLSearchParams({ range });
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/dashboard/overview?${query}`,
      { headers: requestHeaders, cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = DashboardOverviewSchema.safeParse(await response.json());
    return parsed.success ? { value: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
