import "client-only";

import { API_V1_BASE_PATH, type DeliveryTariffUpdate } from "@aaraj/contracts";

export function fetchManagedDeliveryTariff(): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/delivery/manage`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function fetchDeliveryGeography(): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/geography`, {
    cache: "no-store",
    credentials: "same-origin",
  });
}

export function updateManagedDeliveryTariff(
  input: DeliveryTariffUpdate,
): Promise<Response> {
  return fetch(`${API_V1_BASE_PATH}/delivery/manage`, {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
