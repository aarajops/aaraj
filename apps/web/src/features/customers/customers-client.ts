"use client";

import "client-only";
import {
  API_V1_BASE_PATH,
  ManagedCustomerOrdersPageSchema,
  type ManagedCustomerOrdersPage,
} from "@aaraj/contracts";

export async function fetchManagedCustomerOrders(
  customerId: string,
  limit: number,
  offset: number,
): Promise<ManagedCustomerOrdersPage> {
  const search = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(
    `${API_V1_BASE_PATH}/customers/manage/${encodeURIComponent(customerId)}/orders?${search}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  if (!response.ok) throw new Error("Customer order history is unavailable.");
  const parsed = ManagedCustomerOrdersPageSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success)
    throw new Error("Customer order history is unavailable.");
  return parsed.data;
}
