import type { Order } from "@aaraj/contracts";

export function humanize(value: string): string {
  return value
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizeOrderStatus(status: string): string {
  if (status === "no_answer") return "No answer";
  return humanize(status);
}

export function humanizeFulfillmentStatus(
  status: Order["fulfillmentStatus"],
): string {
  if (status === "awaiting_dispatch") return "Awaiting pickup";
  if (status === "dispatched") return "Picked up";
  return humanize(status);
}

export function humanizePathaoStatus(value: string): string {
  const status = value.replace(/^order\./, "");
  if (status === "pickup" || status === "picked") return "Picked up";
  return status
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizePathaoBookingStatus(
  trackingProgress: string,
  providerOrderStatus: string | null,
): string {
  const providerStatus = providerOrderStatus
    ?.toLowerCase()
    .replace(/^order[._-]?/, "")
    .replace(/[^a-z0-9]/g, "");

  if (
    providerStatus &&
    ["updated", "paid", "paidreturn", "exchange", "exchanged"].includes(
      providerStatus,
    )
  ) {
    return humanizePathaoStatus(providerOrderStatus);
  }

  return humanizePathaoStatus(trackingProgress);
}
