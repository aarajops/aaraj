import "server-only";

import { headers } from "next/headers";
import {
  API_V1_BASE_PATH,
  CheckoutDraftListQuerySchema,
  CheckoutDraftListSchema,
  type CheckoutDraftListQuery,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export function parseCheckoutDraftQuery(
  searchParams: Record<string, string | string[] | undefined>,
): CheckoutDraftListQuery {
  if (Object.values(searchParams).some(Array.isArray))
    return CheckoutDraftListQuerySchema.parse({});
  const result = CheckoutDraftListQuerySchema.safeParse(searchParams);
  return result.success ? result.data : CheckoutDraftListQuerySchema.parse({});
}

export async function getCheckoutDrafts(query: CheckoutDraftListQuery) {
  try {
    const cookie = (await headers()).get("cookie");
    const params = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/checkout-drafts?${params}`,
      {
        headers: cookie ? { cookie } : {},
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "unauthenticated" as const };
    if (response.status === 403) return { kind: "forbidden" as const };
    if (!response.ok) return { kind: "unavailable" as const };
    const parsed = CheckoutDraftListSchema.safeParse(await response.json());
    return parsed.success
      ? { value: parsed.data }
      : { kind: "unavailable" as const };
  } catch {
    return { kind: "unavailable" as const };
  }
}
