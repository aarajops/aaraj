"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MAX_CART_QUANTITY_PER_VARIANT, type Cart } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { formatCatalogPrice } from "@/features/catalog/price";
import { CartRequestError, clearGuestCart } from "./cart-client";
import {
  fetchGuestCart,
  removeGuestCartLine,
  setGuestCartLine,
} from "./cart-client";
import { useCartStore } from "./cart-provider";
import { CartQuote } from "./cart-quote";

type MergeMode = "none" | "required" | "retry" | "cleanup";

export function CartPage({ mergeMode }: { mergeMode: MergeMode }) {
  const router = useRouter();
  const cart = useCartStore((state) => state.cart);
  const ready = useCartStore((state) => state.isReady);
  const loading = useCartStore((state) => state.isLoading);
  const mutating = useCartStore((state) => state.isMutating);
  const error = useCartStore((state) => state.error);
  const errorCode = useCartStore((state) => state.errorCode);
  const refresh = useCartStore((state) => state.refresh);
  const clearCart = useCartStore((state) => state.clear);
  const merge = useCartStore((state) => state.merge);
  const setLine = useCartStore((state) => state.setLine);
  const removeLine = useCartStore((state) => state.removeLine);
  const [guestCart, setGuestCart] = useState<Cart | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestErrorCode, setGuestErrorCode] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (mergeMode !== "required") return;
    let active = true;
    void fetchGuestCart()
      .then((guest) => {
        if (active) {
          setGuestCart(guest);
          setGuestError(null);
          setGuestErrorCode(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setGuestErrorCode(
            reason instanceof CartRequestError
              ? (reason.errorCode ?? null)
              : null,
          );
          setGuestError(
            reason instanceof Error
              ? reason.message
              : "The saved guest cart could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [mergeMode]);

  async function retryMerge() {
    setMergeMessage(null);
    try {
      const result = await merge();
      if (result.guestCartCleanupPending) {
        router.replace("/cart?merge=cleanup");
        return;
      }
      router.replace("/cart");
    } catch {
      setMergeMessage(
        "The merge did not complete. Your guest and account carts are kept separate; retry after resolving any listed cart limits.",
      );
    }
  }

  async function resolveGuestLine(action: () => Promise<Cart>): Promise<void> {
    if (!guestCart) return;
    setIsResolving(true);
    setGuestError(null);
    setGuestErrorCode(null);
    try {
      setGuestCart(await action());
    } catch (reason) {
      setGuestErrorCode(
        reason instanceof CartRequestError ? (reason.errorCode ?? null) : null,
      );
      setGuestError(
        reason instanceof Error
          ? reason.message
          : "The guest cart could not be updated.",
      );
    } finally {
      setIsResolving(false);
    }
  }

  async function clearUnreadableGuestCart(): Promise<void> {
    setIsResolving(true);
    setGuestError(null);
    setGuestErrorCode(null);
    try {
      setGuestCart(await clearGuestCart());
    } catch (reason) {
      setGuestErrorCode(
        reason instanceof CartRequestError ? (reason.errorCode ?? null) : null,
      );
      setGuestError(
        reason instanceof Error
          ? reason.message
          : "The saved guest cart could not be cleared.",
      );
    } finally {
      setIsResolving(false);
    }
  }

  const mergeNotice =
    mergeMode === "required"
      ? "Your guest cart could not be merged because an item or cart limit needs attention. Review and adjust the guest items, then retry. Both carts remain unchanged until the merge succeeds."
      : mergeMode === "cleanup"
        ? "Your account cart was updated. Guest-cart cleanup is still pending; retrying is safe."
        : mergeMode === "retry"
          ? "Your sign-in succeeded, but the cart merge could not be confirmed. Retry the merge to recover the guest cart."
          : null;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-primary">
          AARAJ
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Your cart
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prices shown here are saved snapshots and may change before purchase.
        </p>

        {mergeNotice && (
          <section
            className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4"
            role="status"
          >
            <p>{mergeNotice}</p>
            {mergeMessage && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {mergeMessage}
              </p>
            )}
            {mergeMode !== "required" && (
              <Button
                className="mt-4"
                disabled={mutating}
                onClick={() => void retryMerge()}
              >
                {mutating ? "Merging…" : "Retry cart merge"}
              </Button>
            )}
          </section>
        )}

        {error && (
          <p
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        {!ready && loading ? (
          <p className="mt-8" role="status">
            Loading cart…
          </p>
        ) : !ready ? (
          <section className="mt-8 rounded-2xl border border-border p-7">
            <p>{error ?? "The cart could not be loaded."}</p>
            <Button
              className="mt-4"
              disabled={loading}
              onClick={() => void refresh()}
              variant="outline"
            >
              {loading ? "Retrying…" : "Try again"}
            </Button>
            {errorCode === "CART_DATA_INVALID" && (
              <Button
                className="mt-4 sm:ml-3"
                disabled={mutating}
                onClick={() => void clearCart()}
                variant="destructive"
              >
                {mutating ? "Clearing…" : "Clear unreadable cart"}
              </Button>
            )}
          </section>
        ) : cart.lines.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-border p-7">
            <p>Your cart is empty.</p>
            <Link className="mt-4 inline-block text-primary underline" href="/">
              Browse products
            </Link>
          </section>
        ) : (
          <>
            <section
              aria-label="Cart items"
              className="mt-8 rounded-2xl border border-border p-5 sm:p-7"
            >
              <ul className="divide-y divide-border">
                {cart.lines.map((line) => (
                  <li
                    className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    key={line.variantId}
                  >
                    <div>
                      <Link
                        className="font-medium hover:underline"
                        href={`/products/${encodeURIComponent(line.product.slug)}`}
                      >
                        {line.product.name}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {line.product.color} · {line.product.sizeLabel}
                      </p>
                      <p className="mt-1 text-sm">
                        {formatCatalogPrice({
                          amountBdt: line.product.unitPriceBdt,
                        })}{" "}
                        each
                      </p>
                      {line.availability === "unavailable" && (
                        <p
                          className="mt-2 text-sm text-destructive"
                          role="status"
                        >
                          This variant is no longer available. Remove it before
                          checkout.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <label
                        className="sr-only"
                        htmlFor={`quantity-${line.variantId}`}
                      >
                        Quantity for {line.product.name}, {line.product.color},{" "}
                        {line.product.sizeLabel}
                      </label>
                      <select
                        className="h-10 rounded-lg border border-input bg-background px-3"
                        disabled={
                          mutating || line.availability === "unavailable"
                        }
                        id={`quantity-${line.variantId}`}
                        value={line.quantity}
                        onChange={(event) =>
                          void setLine(
                            line.variantId,
                            Number(event.currentTarget.value),
                          )
                        }
                      >
                        {Array.from(
                          { length: MAX_CART_QUANTITY_PER_VARIANT },
                          (_, index) => index + 1,
                        ).map((quantity) => (
                          <option key={quantity} value={quantity}>
                            {quantity}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={mutating}
                        onClick={() => void removeLine(line.variantId)}
                        variant="outline"
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
                The prices above are saved display snapshots, not a checkout
                quote.
              </p>
            </section>
            <CartQuote cart={cart} />
          </>
        )}

        {mergeMode === "required" && (
          <section
            aria-label="Guest cart to resolve"
            className="mt-8 rounded-2xl border border-border p-5 sm:p-7"
          >
            <h2 className="text-xl font-semibold">Guest cart to merge</h2>
            {guestError && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {guestError}
              </p>
            )}
            {guestErrorCode === "CART_DATA_INVALID" && (
              <Button
                className="mt-4"
                disabled={isResolving}
                onClick={() => void clearUnreadableGuestCart()}
                variant="destructive"
              >
                {isResolving ? "Clearing…" : "Clear unreadable guest cart"}
              </Button>
            )}
            {!guestCart ? (
              !guestError && (
                <p className="mt-4" role="status">
                  Loading saved guest cart…
                </p>
              )
            ) : guestCart.lines.length === 0 ? (
              <p className="mt-4">
                The guest cart is empty. You can retry the merge.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {guestCart.lines.map((line) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                    key={line.variantId}
                  >
                    <div>
                      <p className="font-medium">{line.product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {line.product.color} · {line.product.sizeLabel} ·{" "}
                        {line.quantity} in guest cart
                      </p>
                      {line.availability === "unavailable" && (
                        <p className="mt-1 text-sm text-destructive">
                          No longer available; remove this line.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {line.availability === "available" && (
                        <select
                          aria-label={`Guest quantity for ${line.product.name}, ${line.product.color}, ${line.product.sizeLabel}`}
                          className="h-10 rounded-lg border border-input bg-background px-3"
                          disabled={isResolving}
                          value={line.quantity}
                          onChange={(event) =>
                            void resolveGuestLine(() =>
                              setGuestCartLine(
                                line.variantId,
                                Number(event.currentTarget.value),
                                guestCart.revision,
                              ),
                            )
                          }
                        >
                          {Array.from(
                            { length: MAX_CART_QUANTITY_PER_VARIANT },
                            (_, index) => index + 1,
                          ).map((quantity) => (
                            <option key={quantity} value={quantity}>
                              {quantity}
                            </option>
                          ))}
                        </select>
                      )}
                      <Button
                        disabled={isResolving}
                        onClick={() =>
                          void resolveGuestLine(() =>
                            removeGuestCartLine(
                              line.variantId,
                              guestCart.revision,
                            ),
                          )
                        }
                        variant="outline"
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button
              className="mt-5"
              disabled={mutating || isResolving || !guestCart}
              onClick={() => void retryMerge()}
            >
              {mutating ? "Merging…" : "Retry cart merge"}
            </Button>
          </section>
        )}

        <Button
          className="mt-6"
          onClick={() => void refresh()}
          variant="outline"
        >
          Refresh cart
        </Button>
      </div>
    </main>
  );
}
