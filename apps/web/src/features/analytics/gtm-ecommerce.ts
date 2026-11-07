import { sendGTMEvent } from "@next/third-parties/google";
import type { CURRENCY } from "@aaraj/contracts";

export type EcommerceEvent =
  "view_item" | "view_cart" | "add_to_cart" | "begin_checkout" | "purchase";

export type EcommerceItem = {
  item_id?: string;
  item_name: string;
  item_variant?: string;
  price?: number;
  quantity: number;
};

export type EcommercePayload = {
  currency: typeof CURRENCY;
  value?: number;
  shipping?: number;
  transaction_id?: string;
  items: EcommerceItem[];
};

export function cartItem(
  line: {
    variantId: string;
    quantity: number;
    product: {
      name: string;
      color: string;
      sizeLabel: string;
      unitPriceBdt: number;
    };
  },
  quantity = line.quantity,
): EcommerceItem {
  return variantEcommerceItem({
    variantId: line.variantId,
    itemName: line.product.name,
    color: line.product.color,
    sizeLabel: line.product.sizeLabel,
    price: line.product.unitPriceBdt,
    quantity,
  });
}

export function variantEcommerceItem(item: {
  variantId: string;
  itemName: string;
  color: string;
  sizeLabel: string;
  price: number;
  quantity: number;
}): EcommerceItem {
  return {
    item_id: item.variantId,
    item_name: item.itemName,
    item_variant: `${item.color} / ${item.sizeLabel}`,
    price: item.price,
    quantity: item.quantity,
  };
}

export function cartValue(
  lines: Array<{ quantity: number; product: { unitPriceBdt: number } }>,
) {
  return lines.reduce(
    (total, line) => total + line.product.unitPriceBdt * line.quantity,
    0,
  );
}

export function sendEcommerceEvent(
  event: EcommerceEvent,
  ecommerce: EcommercePayload,
  eventId?: string,
) {
  if (typeof window === "undefined") return false;

  const stableEventId = eventId ?? window.crypto.randomUUID();
  sendGTMEvent({ ecommerce: null });
  sendGTMEvent({
    event,
    event_id: stableEventId,
    ecommerce,
  });
  return true;
}

const pageViewQueryParameters = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "dclid",
  "fbclid",
]);

export function sendPageView(pathname: string) {
  if (typeof window === "undefined") return false;

  const pageUrl = new URL(window.location.href);
  for (const key of [...pageUrl.searchParams.keys()]) {
    if (!pageViewQueryParameters.has(key.toLowerCase())) {
      pageUrl.searchParams.delete(key);
    }
  }

  sendGTMEvent({
    event: "page_view",
    page_location: `${pageUrl.origin}${pathname}${pageUrl.search}`,
    page_title: document.title,
  });
  return true;
}
