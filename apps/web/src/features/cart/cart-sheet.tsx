"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useEffect } from "react";
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
  const cart = useCartStore((state) => state.cart);
  const isReady = useCartStore((state) => state.isReady);
  const isLoading = useCartStore((state) => state.isLoading);
  const isMutating = useCartStore((state) => state.isMutating);
  const error = useCartStore((state) => state.error);
  const refresh = useCartStore((state) => state.refresh);
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
    <Sheet>
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
              <SheetClose
                className={buttonVariants({
                  className: "mt-2",
                  variant: "outline",
                })}
                nativeButton={false}
                render={<Link href="/" />}
              >
                Continue shopping
              </SheetClose>
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
                    <SheetClose
                      className="font-medium hover:underline"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/products/${encodeURIComponent(line.product.slug)}`}
                        />
                      }
                    >
                      {line.product.name}
                    </SheetClose>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {line.product.color} · {line.product.sizeLabel}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Quantity: {line.quantity}
                    </p>
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
                    <p className="font-medium">
                      {formatCatalogPrice({
                        amountBdt: line.product.unitPriceBdt * line.quantity,
                      })}
                    </p>
                    <Button
                      className="mt-2"
                      disabled={isMutating}
                      onClick={() => void removeLine(line.variantId)}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {isReady && cart.lines.length > 0 && (
          <SheetFooter className="border-t border-border p-6">
            <div className="flex items-center justify-between gap-4 text-base font-medium">
              <span>Estimated subtotal</span>
              <span>{formatCatalogPrice({ amountBdt: subtotal })}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Saved prices are estimates. Delivery and the final total are
              calculated in your cart.
            </p>
            <SheetClose
              className={buttonVariants({ className: "w-full" })}
              nativeButton={false}
              render={<Link href="/cart" />}
            >
              View cart
            </SheetClose>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
