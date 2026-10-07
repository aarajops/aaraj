"use client";

import { createContext, useContext, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { createCartStore, type CartStore } from "./cart-store";

const CartStoreContext = createContext<StoreApi<CartStore> | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createCartStore());
  return (
    <CartStoreContext.Provider value={store}>
      {children}
    </CartStoreContext.Provider>
  );
}

export function useCartStore<T>(selector: (state: CartStore) => T): T {
  const store = useContext(CartStoreContext);
  if (!store)
    throw new Error("CartProvider is missing from the storefront layout.");
  return useStore(store, selector);
}
