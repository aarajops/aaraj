import {
  API_V1_BASE_PATH,
  type InventoryAdjustmentInput,
  type InventoryListQuery,
} from "@aaraj/contracts";

function inventoryPath(path: string): string {
  return `${API_V1_BASE_PATH}/inventory${path}`;
}

export function fetchManagedInventory(
  query: InventoryListQuery,
): Promise<Response> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.search) search.set("search", query.search);
  return fetch(`${inventoryPath("/manage")}?${search}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchManagedInventoryVariant(
  variantId: string,
): Promise<Response> {
  return fetch(inventoryPath(`/manage/${encodeURIComponent(variantId)}`), {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function createInventoryAdjustment(
  variantId: string,
  input: InventoryAdjustmentInput,
): Promise<Response> {
  return fetch(
    inventoryPath(`/manage/${encodeURIComponent(variantId)}/adjustments`),
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
