"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { useCartStore } from "./cart-provider";

export function CartBadge() {
  const refresh = useCartStore((state) => state.refresh);
  const lines = useCartStore((state) => state.cart.lines);
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Link
      aria-label={`Cart, ${totalQuantity} ${totalQuantity === 1 ? "item" : "items"}`}
      className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm text-foreground hover:border-ring"
      href="/cart"
    >
      <ShoppingBag aria-hidden="true" className="size-4" />
      Cart
      <span
        aria-hidden="true"
        className="rounded-full bg-muted px-2 py-0.5 text-xs"
      >
        {totalQuantity}
      </span>
    </Link>
  );
}
