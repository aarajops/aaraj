"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCartSheet, useCartStore } from "./cart-provider";

export function AddToCart({
  variantId,
  stickyPrice,
  onVariantRequired,
}: {
  variantId: string | null;
  stickyPrice?: ReactNode;
  onVariantRequired?: () => void;
}) {
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
    if (added) {
      setCartSheetOpen(true);
    }
  }

  async function clearUnreadableCart() {
    if (await clearCart()) {
      setStatus("Your unreadable saved cart was cleared. Add this item again.");
    }
  }

  async function buyNow() {
    if (!isReady || error || isMutating || isLoading) return;
    if (!variantId) {
      onVariantRequired?.();
      return;
    }

    const existingQuantity =
      cart.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
    if (existingQuantity === 0) {
      setIsBuyingNow(true);
      const added = await setLine(variantId, 1);
      setIsBuyingNow(false);
      if (!added) return;
    }
    router.push("/checkout");
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
    isMutating || isBuyingNow || isLoading || !isReady || Boolean(error);

  function renderCartButton() {
    return (
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
        variant="outline"
      >
        {!isReady && !error ? (
          <Spinner aria-label="Loading cart" />
        ) : (
          <>
            <ShoppingCart aria-hidden="true" />
            {isMutating
              ? "Updating cart…"
              : !isReady
                ? errorCode === "CART_DATA_INVALID"
                  ? "Clear cart"
                  : "Retry cart"
                : quantityLimitReached
                  ? "Limit reached"
                  : "Add to Cart"}
          </>
        )}
      </Button>
    );
  }

  function renderBuyNowButton(className = "w-full") {
    return (
      <Button
        className={className}
        disabled={buyNowDisabled}
        onClick={() => void buyNow()}
        size="lg"
        type="button"
      >
        <ArrowRight aria-hidden="true" />
        {isBuyingNow ? "Continuing…" : "Buy Now"}
      </Button>
    );
  }

  function renderButtons() {
    return (
      <div className="grid grid-cols-2 gap-3">
        {renderCartButton()}
        {renderBuyNowButton()}
      </div>
    );
  }

  return (
    <div>
      <section aria-label="Product purchase actions" className="space-y-3">
        {renderButtons()}
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
      <div
        aria-label="Quick purchase actions"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-card px-5 py-3 shadow-lg sm:hidden"
        role="group"
      >
        {stickyPrice && <div className="min-w-0">{stickyPrice}</div>}
        {renderBuyNowButton("w-auto")}
      </div>
    </div>
  );
}
