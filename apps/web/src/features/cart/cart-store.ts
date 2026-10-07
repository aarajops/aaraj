import { createStore } from "zustand/vanilla";
import type { Cart, CartMergeResult } from "@aaraj/contracts";
import {
  CartRequestError,
  fetchCart,
  clearCart as clearCartRequest,
  mergeGuestCart,
  removeCartLine,
  setCartLine,
} from "./cart-client";

const EMPTY_CART: Cart = {
  schemaVersion: 1,
  currency: "BDT",
  revision: 0,
  lines: [],
};

export type CartStore = {
  cart: Cart;
  isReady: boolean;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
  clear: () => Promise<boolean>;
  setLine: (variantId: string, quantity: number) => Promise<boolean>;
  removeLine: (variantId: string) => Promise<boolean>;
  merge: () => Promise<CartMergeResult>;
  replaceCart: (cart: Cart) => void;
};

export function createCartStore() {
  return createStore<CartStore>()((set, get) => ({
    cart: EMPTY_CART,
    isReady: false,
    isLoading: false,
    isMutating: false,
    error: null,
    errorCode: null,
    replaceCart: (cart) =>
      set({ cart, isReady: true, error: null, errorCode: null }),
    refresh: async () => {
      set({ isLoading: true, error: null, errorCode: null });
      try {
        const cart = await fetchCart();
        set({ cart, isReady: true, error: null, errorCode: null });
      } catch (error) {
        set({
          error: getErrorMessage(error),
          errorCode: getErrorCode(error),
        });
      } finally {
        set({ isLoading: false });
      }
    },
    clear: async () => {
      set({ isMutating: true, error: null, errorCode: null });
      try {
        const cart = await clearCartRequest();
        set({ cart, isReady: true, error: null, errorCode: null });
        return true;
      } catch (error) {
        set({
          error: getErrorMessage(error),
          errorCode: getErrorCode(error),
        });
        return false;
      } finally {
        set({ isMutating: false });
      }
    },
    setLine: async (variantId, quantity) => {
      if (!get().isReady) await get().refresh();
      if (get().error && !get().isReady) return false;
      set({ isMutating: true, error: null });
      try {
        const cart = await setCartLine(
          variantId,
          quantity,
          get().cart.revision,
        );
        set({ cart, isReady: true, error: null, errorCode: null });
        return true;
      } catch (error) {
        set({
          error: getErrorMessage(error),
          errorCode: getErrorCode(error),
        });
        if (
          error instanceof CartRequestError &&
          error.errorCode === "CART_REVISION_CONFLICT"
        ) {
          await get().refresh();
          set({
            error: getErrorMessage(error),
            errorCode: getErrorCode(error),
          });
        }
        return false;
      } finally {
        set({ isMutating: false });
      }
    },
    removeLine: async (variantId) => {
      if (!get().isReady) await get().refresh();
      if (get().error && !get().isReady) return false;
      set({ isMutating: true, error: null });
      try {
        const cart = await removeCartLine(variantId, get().cart.revision);
        set({ cart, isReady: true, error: null, errorCode: null });
        return true;
      } catch (error) {
        set({
          error: getErrorMessage(error),
          errorCode: getErrorCode(error),
        });
        if (
          error instanceof CartRequestError &&
          error.errorCode === "CART_REVISION_CONFLICT"
        ) {
          await get().refresh();
          set({
            error: getErrorMessage(error),
            errorCode: getErrorCode(error),
          });
        }
        return false;
      } finally {
        set({ isMutating: false });
      }
    },
    merge: async () => {
      set({ isMutating: true, error: null });
      try {
        const result = await mergeGuestCart();
        set({
          cart: result.cart,
          isReady: true,
          error: null,
          errorCode: null,
        });
        return result;
      } catch (error) {
        set({
          error: getErrorMessage(error),
          errorCode: getErrorCode(error),
        });
        throw error;
      } finally {
        set({ isMutating: false });
      }
    },
  }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The cart request could not be completed.";
}

function getErrorCode(error: unknown): string | null {
  return error instanceof CartRequestError ? (error.errorCode ?? null) : null;
}
