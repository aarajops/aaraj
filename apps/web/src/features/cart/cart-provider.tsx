"use client";

import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { createCartStore, type CartStore } from "./cart-store";

const CartStoreContext = createContext<StoreApi<CartStore> | null>(null);
const CartSheetContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createCartStore());
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  return (
    <CartSheetContext.Provider
      value={{ open: cartSheetOpen, setOpen: setCartSheetOpen }}
    >
      <CartStoreContext.Provider value={store}>
        {children}
      </CartStoreContext.Provider>
    </CartSheetContext.Provider>
  );
}

export function useCartStore<T>(selector: (state: CartStore) => T): T {
  const store = useContext(CartStoreContext);
  if (!store)
    throw new Error("CartProvider is missing from the storefront layout.");
  return useStore(store, selector);
}

export function useCartSheet() {
  const cartSheet = useContext(CartSheetContext);
  if (!cartSheet)
    throw new Error("CartProvider is missing from the storefront layout.");
  return cartSheet;
}
