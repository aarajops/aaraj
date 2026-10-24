import { sendGTMEvent } from "@next/third-parties/google";

export type EcommerceEvent =
  | "view_item"
  | "add_to_cart"
  | "begin_checkout"
  | "purchase";

export type EcommerceItem = {
  item_id?: string;
  item_name: string;
  item_variant?: string;
  price?: number;
  quantity: number;
};

export type EcommercePayload = {
  currency: "BDT";
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
  if (typeof window === "undefined") return;
  const stableEventId = eventId ?? window.crypto.randomUUID();
  sendGTMEvent({ ecommerce: null });
  sendGTMEvent({ event, event_id: stableEventId, ecommerce });
}
