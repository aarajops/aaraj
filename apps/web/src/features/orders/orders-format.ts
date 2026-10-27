export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizeOrderStatus(status: string): string {
  return status === "awaiting_confirmation" ? "Pending" : humanize(status);
}

export function currentOrderStatusLabel(
  status: string,
  fulfillmentStatus: string,
): string {
  if (status === "confirmed" && fulfillmentStatus !== "awaiting_dispatch") {
    return humanize(fulfillmentStatus);
  }
  return humanizeOrderStatus(status);
}
