"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatCatalogPrice } from "@/features/catalog/price";
import { useCartStore } from "./cart-provider";

export function CartSheet() {
  const [open, setOpen] = useState(false);
  const cart = useCartStore((state) => state.cart);
  const isReady = useCartStore((state) => state.isReady);
  const isLoading = useCartStore((state) => state.isLoading);
  const isMutating = useCartStore((state) => state.isMutating);
  const error = useCartStore((state) => state.error);
  const refresh = useCartStore((state) => state.refresh);
  const setLine = useCartStore((state) => state.setLine);
  const removeLine = useCartStore((state) => state.removeLine);
  const totalQuantity = cart.lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const subtotal = cart.lines.reduce(
    (total, line) => total + line.product.unitPriceBdt * line.quantity,
    0,
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        aria-label={`Open cart, ${totalQuantity} ${totalQuantity === 1 ? "item" : "items"}`}
        className="relative inline-flex size-10 items-center justify-center text-foreground hover:text-primary"
      >
        <ShoppingBag aria-hidden="true" className="size-4" />
        {totalQuantity > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground"
          >
            {totalQuantity}
          </span>
        )}
      </SheetTrigger>

      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-6 pr-14">
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            {totalQuantity} {totalQuantity === 1 ? "item" : "items"} in your
            cart
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
          {error && (
            <div
              className="my-4 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              <p>{error}</p>
              <Button
                className="shrink-0"
                onClick={() => void refresh()}
                size="sm"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          )}

          {!isReady ? (
            <p className="py-8 text-sm text-muted-foreground" role="status">
              {isLoading || !error
                ? "Loading your cart…"
                : "Your cart could not be loaded."}
            </p>
          ) : cart.lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
              <ShoppingBag
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <p className="font-medium">Your cart is empty.</p>
              <p className="text-sm text-muted-foreground">
                Browse the collection to find something you love.
              </p>
              <Link
                className={buttonVariants({
                  className: "mt-2",
                  variant: "outline",
                })}
                href="/shop"
                onNavigate={() => setOpen(false)}
              >
                Continue shopping
              </Link>
            </div>
          ) : (
            <ul
              aria-label="Items in your cart"
              className="divide-y divide-border"
            >
              {cart.lines.map((line) => (
                <li
                  className="flex items-start justify-between gap-4 py-5"
                  key={line.variantId}
                >
                  <div className="min-w-0">
                    <Link
                      className="text-base font-semibold hover:underline"
                      href={`/shop/products/${line.product.slug}`}
                      onNavigate={() => setOpen(false)}
                    >
                      {line.product.name}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {line.product.color} · {line.product.sizeLabel}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <div
                        aria-label={`Quantity for ${line.product.name}, ${line.product.color}, ${line.product.sizeLabel}`}
                        className="inline-flex h-10 items-center gap-1 rounded-lg border border-input px-1"
                        role="group"
                      >
                        <Button
                          aria-label={`Decrease quantity for ${line.product.name}, ${line.product.color}, ${line.product.sizeLabel}`}
                          className="rounded-md"
                          disabled={
                            isMutating ||
                            line.availability === "unavailable" ||
                            line.quantity <= 1
                          }
                          onClick={() =>
                            void setLine(line.variantId, line.quantity - 1)
                          }
                          size="icon-lg"
                          variant="ghost"
                        >
                          <Minus aria-hidden="true" />
                        </Button>
                        <span
                          aria-live="polite"
                          className="min-w-5 text-center text-sm tabular-nums"
                        >
                          {line.quantity}
                        </span>
                        <Button
                          aria-label={`Increase quantity for ${line.product.name}, ${line.product.color}, ${line.product.sizeLabel}`}
                          className="rounded-md"
                          disabled={
                            isMutating ||
                            line.availability === "unavailable" ||
                            line.quantity >= MAX_CART_QUANTITY_PER_VARIANT
                          }
                          onClick={() =>
                            void setLine(line.variantId, line.quantity + 1)
                          }
                          size="icon-lg"
                          variant="ghost"
                        >
                          <Plus aria-hidden="true" />
                        </Button>
                      </div>
                      <Button
                        aria-label={`Remove ${line.product.name}, ${line.product.color}, ${line.product.sizeLabel}`}
                        className="text-muted-foreground hover:text-destructive"
                        disabled={isMutating}
                        onClick={() => void removeLine(line.variantId)}
                        size="sm"
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    </div>
                    {line.availability === "unavailable" && (
                      <p
                        className="mt-2 text-sm text-destructive"
                        role="status"
                      >
                        Unavailable. Review this item in your cart.
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    {line.quantity > 1 && (
                      <p className="text-sm text-muted-foreground">
                        {formatCatalogPrice({
                          amountBdt: line.product.unitPriceBdt,
                        })}{" "}
                        each
                      </p>
                    )}
                    <p
                      className={
                        line.quantity > 1
                          ? "mt-1 font-semibold"
                          : "font-semibold"
                      }
                    >
                      {formatCatalogPrice({
                        amountBdt: line.product.unitPriceBdt * line.quantity,
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isReady && cart.lines.length > 0 && (
          <SheetFooter className="mt-auto w-full gap-0 border-t border-border p-0">
            <div className="flex items-center justify-between gap-4 px-6 py-5 text-base font-medium">
              <span>Subtotal</span>
              <span>{formatCatalogPrice({ amountBdt: subtotal })}</span>
            </div>
            <div className="grid w-full grid-cols-2 gap-0">
              <SheetClose
                render={
                  <Button className="w-full" size="lg" variant="outline" />
                }
              >
                Cancel
              </SheetClose>
              <Link
                className={buttonVariants({
                  className: "w-full",
                  size: "lg",
                })}
                href="/cart"
                onNavigate={() => setOpen(false)}
              >
                Checkout
              </Link>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
