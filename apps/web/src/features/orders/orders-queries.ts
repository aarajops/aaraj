import "server-only";

import { headers } from "next/headers";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  API_V1_BASE_PATH,
  OrderListQuerySchema,
  OrderManagementListSchema,
  OrderSchema,
  type Order,
  type OrderListQuery,
  type OrderManagementList,
} from "@aaraj/contracts";

export type OrdersPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
};

const defaultOrderListQuery = OrderListQuerySchema.parse({});

export function parseOrdersPageQuery(
  searchParams: OrdersPageSearchParams,
): OrderListQuery {
  if (
    Array.isArray(searchParams.limit) ||
    Array.isArray(searchParams.offset) ||
    Array.isArray(searchParams.search)
  ) {
    return defaultOrderListQuery;
  }

  const result = OrderListQuerySchema.safeParse(searchParams);
  return result.success ? result.data : defaultOrderListQuery;
}

type StaffOrderResult<T> =
  | { value: T }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

async function requestHeaders(): Promise<HeadersInit> {
  const cookie = (await headers()).get("cookie");
  return cookie ? { cookie } : {};
}

export async function getManagedOrders(
  query: OrderListQuery,
): Promise<StaffOrderResult<OrderManagementList>> {
  try {
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.search) search.set("search", query.search);
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/orders/manage?${search}`,
      { headers: await requestHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = OrderManagementListSchema.safeParse(await response.json());
    return parsed.success ? { value: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getManagedOrder(
  orderId: string,
): Promise<StaffOrderResult<Order>> {
  try {
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}`,
      { headers: await requestHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = OrderSchema.safeParse(await response.json());
    return parsed.success ? { value: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
