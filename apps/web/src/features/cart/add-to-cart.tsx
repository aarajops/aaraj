"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { useCartSheet, useCartStore } from "./cart-provider";

export function AddToCart({ variantId }: { variantId: string | null }) {
  const router = useRouter();
  const { setOpen: setCartSheetOpen } = useCartSheet();
  const setLine = useCartStore((state) => state.setLine);
  const refresh = useCartStore((state) => state.refresh);
  const clearCart = useCartStore((state) => state.clear);
  const isMutating = useCartStore((state) => state.isMutating);
  const isLoading = useCartStore((state) => state.isLoading);
  const isReady = useCartStore((state) => state.isReady);
  const cart = useCartStore((state) => state.cart);
  const error = useCartStore((state) => state.error);
  const errorCode = useCartStore((state) => state.errorCode);
  const [status, setStatus] = useState<string | null>(null);
  const [isBuyingNow, setIsBuyingNow] = useState(false);

  async function addSelectedVariant() {
    if (!variantId) return;
    setStatus(null);
    const existingQuantity =
      cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
    const added = await setLine(variantId, existingQuantity + 1);
    if (added) setCartSheetOpen(true);
  }

  async function clearUnreadableCart() {
    if (await clearCart()) {
      setStatus("Your unreadable saved cart was cleared. Add this item again.");
    }
  }

  async function buyNow() {
    if (!variantId || !isReady || error || isMutating || isLoading) return;

    const existingQuantity =
      cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
    if (existingQuantity === 0) {
      setIsBuyingNow(true);
      const added = await setLine(variantId, 1);
      setIsBuyingNow(false);
      if (!added) return;
    }
    router.push("/cart#delivery-and-order-total");
  }

  const selectedQuantity =
    cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
  const quantityLimitReached =
    Boolean(variantId) && selectedQuantity >= MAX_CART_QUANTITY_PER_VARIANT;
  const disabled =
    isMutating ||
    isBuyingNow ||
    isLoading ||
    (!isReady && !error) ||
    (isReady && (!variantId || quantityLimitReached));
  const buyNowDisabled =
    isMutating ||
    isBuyingNow ||
    isLoading ||
    !isReady ||
    Boolean(error) ||
    !variantId;

  return (
    <section aria-label="Product purchase actions" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Button
          className="w-full"
          disabled={disabled}
          onClick={() => {
            if (isReady) void addSelectedVariant();
            else if (errorCode === "CART_DATA_INVALID") {
              void clearUnreadableCart();
            } else void refresh();
          }}
          size="lg"
          type="button"
        >
          {isMutating
            ? "Updating cart…"
            : !isReady
              ? errorCode === "CART_DATA_INVALID"
                ? "Clear cart"
                : error
                  ? "Retry cart"
                  : "Loading cart…"
              : !variantId
                ? "Choose options"
                : quantityLimitReached
                  ? "Limit reached"
                  : "Add to Cart"}
        </Button>
        <Button
          className="w-full"
          disabled={buyNowDisabled}
          onClick={() => void buyNow()}
          size="lg"
          type="button"
          variant="outline"
        >
          {isBuyingNow ? "Continuing…" : "Buy Now"}
        </Button>
      </div>
      {status && (
        <p className="text-sm" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
