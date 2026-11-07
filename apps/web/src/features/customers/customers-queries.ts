import "server-only";

import { headers } from "next/headers";
import {
  API_V1_BASE_PATH,
  CustomerDirectoryQuerySchema,
  ManagedCustomerDirectorySchema,
  type CustomerDirectoryQuery,
  type ManagedCustomerDirectory,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export type CustomersPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
};

const defaultQuery = CustomerDirectoryQuerySchema.parse({});

export function parseCustomersPageQuery(
  searchParams: CustomersPageSearchParams,
): CustomerDirectoryQuery {
  if (
    Array.isArray(searchParams.limit) ||
    Array.isArray(searchParams.offset) ||
    Array.isArray(searchParams.search)
  ) {
    return defaultQuery;
  }

  const result = CustomerDirectoryQuerySchema.safeParse(searchParams);
  return result.success ? result.data : defaultQuery;
}

type ManagedCustomersResult =
  | { page: ManagedCustomerDirectory }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getManagedCustomers(
  query: CustomerDirectoryQuery,
): Promise<ManagedCustomersResult> {
  try {
    const cookie = (await headers()).get("cookie");
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    const requestHeaders = new Headers();
    if (cookie) requestHeaders.set("cookie", cookie);
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/customers/manage?${search}`,
      { headers: requestHeaders, cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const page = ManagedCustomerDirectorySchema.safeParse(
      await response.json(),
    );
    return page.success ? { page: page.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
