"use client";

import { useState } from "react";
import {
  MAX_CART_QUANTITY_PER_VARIANT,
  type CatalogProductDetail,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { useCartStore } from "./cart-provider";

export function AddToCart({
  productName,
  variants,
}: {
  productName: string;
  variants: CatalogProductDetail["variants"];
}) {
  const setLine = useCartStore((state) => state.setLine);
  const refresh = useCartStore((state) => state.refresh);
  const clearCart = useCartStore((state) => state.clear);
  const isMutating = useCartStore((state) => state.isMutating);
  const isLoading = useCartStore((state) => state.isLoading);
  const isReady = useCartStore((state) => state.isReady);
  const cart = useCartStore((state) => state.cart);
  const error = useCartStore((state) => state.error);
  const errorCode = useCartStore((state) => state.errorCode);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);

  if (variants.length === 0) return null;

  async function addSelectedVariant() {
    const existingQuantity =
      cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
    const added = await setLine(variantId, existingQuantity + 1);
    setStatus(
      added
        ? `${productName} added to your cart.`
        : "The item could not be added. Review the message and retry.",
    );
  }

  async function clearUnreadableCart() {
    if (await clearCart()) {
      setStatus("Your unreadable saved cart was cleared. Add this item again.");
    }
  }

  const selectedQuantity =
    cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
  const quantityLimitReached =
    selectedQuantity >= MAX_CART_QUANTITY_PER_VARIANT;

  return (
    <section
      aria-label="Add product to cart"
      className="mt-8 border-t border-border pt-6"
    >
      <label className="block text-sm font-medium" htmlFor="cart-variant">
        Choose a color and size
      </label>
      <select
        className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground"
        id="cart-variant"
        value={variantId}
        onChange={(event) => setVariantId(event.currentTarget.value)}
      >
        {variants.map((variant) => (
          <option key={variant.id} value={variant.id}>
            {variant.color} · {variant.sizeLabel}
          </option>
        ))}
      </select>
      <Button
        className="mt-4 w-full sm:w-auto"
        disabled={
          isMutating ||
          isLoading ||
          (!isReady && !error) ||
          !variantId ||
          quantityLimitReached
        }
        onClick={() => {
          if (isReady) void addSelectedVariant();
          else if (errorCode === "CART_DATA_INVALID") {
            void clearUnreadableCart();
          } else void refresh();
        }}
        type="button"
      >
        {isMutating
          ? "Updating cart…"
          : !isReady
            ? errorCode === "CART_DATA_INVALID"
              ? "Clear unreadable cart"
              : error
                ? "Retry cart"
                : "Loading cart…"
            : quantityLimitReached
              ? "Maximum quantity reached"
              : "Add to cart"}
      </Button>
      {status && (
        <p className="mt-3 text-sm" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
