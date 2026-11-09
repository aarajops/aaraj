import "server-only";

import { headers } from "next/headers";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  API_V1_BASE_PATH,
  OrderListQuerySchema,
  OrderManagementDetailSchema,
  OrderManagementListSchema,
  type OrderManagementDetail,
  type OrderListQuery,
  type OrderManagementList,
} from "@aaraj/contracts";

export type OrdersPageSearchParams = {
  limit?: string | string[];
  offset?: string | string[];
  search?: string | string[];
  status?: string | string[];
  fulfillmentStatus?: string | string[];
  createdFrom?: string | string[];
  createdBefore?: string | string[];
};

const defaultOrderListQuery = OrderListQuerySchema.parse({});

export function parseOrdersPageQuery(
  searchParams: OrdersPageSearchParams,
): OrderListQuery {
  if (
    Array.isArray(searchParams.limit) ||
    Array.isArray(searchParams.offset) ||
    Array.isArray(searchParams.search) ||
    Array.isArray(searchParams.status) ||
    Array.isArray(searchParams.fulfillmentStatus) ||
    Array.isArray(searchParams.createdFrom) ||
    Array.isArray(searchParams.createdBefore)
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
    if (query.status) search.set("status", query.status);
    if (query.fulfillmentStatus) {
      search.set("fulfillmentStatus", query.fulfillmentStatus);
    }
    if (query.createdFrom) search.set("createdFrom", query.createdFrom);
    if (query.createdBefore) search.set("createdBefore", query.createdBefore);
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
): Promise<StaffOrderResult<OrderManagementDetail>> {
  try {
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/orders/manage/${encodeURIComponent(orderId)}`,
      { headers: await requestHeaders(), cache: "no-store" },
    );
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = OrderManagementDetailSchema.safeParse(await response.json());
    return parsed.success ? { value: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
