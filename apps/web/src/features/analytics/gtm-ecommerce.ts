import { sendGTMEvent } from "@next/third-parties/google";
import type { CURRENCY } from "@aaraj/contracts";

export type EcommerceEvent =
  "view_item" | "add_to_cart" | "begin_checkout" | "purchase";

type MetaStandardEventName =
  "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";

const metaEventNameByEcommerceEvent = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
} as const satisfies Record<EcommerceEvent, MetaStandardEventName>;

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

type MetaPixel = (
  command: "track",
  eventName: "Purchase",
  parameters: {
    value: number;
    currency: typeof CURRENCY;
    content_ids: string[];
    content_type: "product";
    contents: Array<{ id?: string; quantity: number; item_price?: number }>;
    order_id?: string;
    shipping?: number;
  },
  options: { eventID: string },
) => void;

declare global {
  interface Window {
    fbq?: MetaPixel;
  }
}

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
  if (typeof window === "undefined") return;

  const stableEventId = eventId ?? window.crypto.randomUUID();
  if (event === "purchase") {
    window.fbq?.(
      "track",
      "Purchase",
      {
        value: ecommerce.value ?? 0,
        currency: ecommerce.currency,
        content_ids: ecommerce.items.flatMap((item) =>
          item.item_id ? [item.item_id] : [],
        ),
        content_type: "product",
        contents: ecommerce.items.map((item) => ({
          id: item.item_id,
          quantity: item.quantity,
          item_price: item.price,
        })),
        order_id: ecommerce.transaction_id,
        shipping: ecommerce.shipping,
      },
      { eventID: stableEventId },
    );
  }

  sendGTMEvent({ ecommerce: null });
  sendGTMEvent({
    event,
    meta_event_name: metaEventNameByEcommerceEvent[event],
    event_id: stableEventId,
    ecommerce,
  });
}
