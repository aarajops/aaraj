import { sendGTMEvent } from "@next/third-parties/google";
import type { CURRENCY, Order } from "@aaraj/contracts";

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

const purchaseKey = (orderId: string) => `aaraj.analytics.purchase:${orderId}`;

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

export function markPurchasePending(orderId: string) {
  try {
    window.sessionStorage.setItem(purchaseKey(orderId), "1");
  } catch {
    // Analytics must not block checkout completion.
  }
}

export function sendCheckoutPurchase(order: Order) {
  const key = purchaseKey(order.id);
  try {
    if (window.sessionStorage.getItem(key) !== "1") return;
    window.sessionStorage.removeItem(key);

    sendEcommerceEvent(
      "purchase",
      {
        transaction_id: order.reference,
        currency: order.currency,
        value: order.merchandiseGrossBdt,
        shipping: order.delivery.grossAmountBdt,
        items: order.lines.map((line) =>
          variantEcommerceItem({
            variantId: line.variantId,
            itemName: line.productName,
            color: line.color,
            sizeLabel: line.sizeLabel,
            price: line.unitPriceBdt,
            quantity: line.quantity,
          }),
        ),
      },
      order.id,
    );
  } catch {
    // Analytics must not block order confirmation.
  }
}

export function sendEcommerceEvent(
  event: EcommerceEvent,
  ecommerce: EcommercePayload,
  eventId?: string,
) {
  if (typeof window === "undefined") return;

  const stableEventId = eventId ?? window.crypto.randomUUID();
  sendGTMEvent({ ecommerce: null });
  sendGTMEvent({
    event,
    meta_event_name: metaEventNameByEcommerceEvent[event],
    event_id: stableEventId,
    ecommerce,
  });
}
