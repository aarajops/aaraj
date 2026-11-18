import { createStore } from "zustand/vanilla";
import {
  CART_CURRENCY,
  type Cart,
  type CartMergeResult,
  type CartAddComboInput,
} from "@aaraj/contracts";
import {
  cartItem,
  sendEcommerceEvent,
} from "@/features/analytics/gtm-ecommerce";
import {
  CartRequestError,
  fetchCart,
  addCartCombo as addCartComboRequest,
  clearCart as clearCartRequest,
  mergeGuestCart,
  removeCartLine,
  removeCartCombo,
  setCartLine,
  setCartCombo,
} from "./cart-client";

const EMPTY_CART: Cart = {
  schemaVersion: 1,
  currency: CART_CURRENCY,
  revision: 0,
  lines: [],
  combos: [],
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
  addCombo: (input: Omit<CartAddComboInput, "revision">) => Promise<boolean>;
  setComboQuantity: (lineId: string, quantity: number) => Promise<boolean>;
  removeCombo: (lineId: string) => Promise<boolean>;
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
      const previousLine = get().cart.lines.find(
        (line) => line.variantId === variantId,
      );
      const previousQuantity = previousLine?.quantity ?? 0;
      set({ isMutating: true, error: null });
      try {
        const cart = await setCartLine(
          variantId,
          quantity,
          get().cart.revision,
        );
        set({ cart, isReady: true, error: null, errorCode: null });
        const currentLine = cart.lines.find(
          (line) => line.variantId === variantId,
        );
        if (currentLine && quantity > previousQuantity) {
          const delta = quantity - previousQuantity;
          sendEcommerceEvent("add_to_cart", {
            currency: cart.currency,
            value: currentLine.product.unitPriceBdt * delta,
            items: [cartItem(currentLine, delta)],
          });
        }
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
    addCombo: async (input) => {
      if (!get().isReady) await get().refresh();
      if (get().error && !get().isReady) return false;
      set({ isMutating: true, error: null, errorCode: null });
      try {
        const cart = await addCartComboRequest({
          ...input,
          revision: get().cart.revision,
        });
        set({ cart, isReady: true, error: null, errorCode: null });
        const line = cart.combos.find(
          (combo) =>
            combo.productId === input.productId &&
            combo.comboRevision === input.comboRevision &&
            combo.selections.every((selection) =>
              input.selections.some(
                (chosen) =>
                  chosen.componentId === selection.componentId &&
                  chosen.variantId === selection.variantId,
              ),
            ),
        );
        if (line) {
          sendEcommerceEvent("add_to_cart", {
            currency: cart.currency,
            value: line.unitPriceBdt * input.quantity,
            items: [
              {
                item_id: line.productId,
                item_name: line.name,
                item_variant: line.selections
                  .map(({ color, sizeLabel }) => `${color} / ${sizeLabel}`)
                  .join(", "),
                price: line.unitPriceBdt,
                quantity: input.quantity,
              },
            ],
          });
        }
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
    setComboQuantity: async (lineId, quantity) => {
      if (!get().isReady) await get().refresh();
      if (get().error && !get().isReady) return false;
      set({ isMutating: true, error: null, errorCode: null });
      try {
        const cart = await setCartCombo(lineId, quantity, get().cart.revision);
        set({ cart, isReady: true, error: null, errorCode: null });
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error), errorCode: getErrorCode(error) });
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
    removeCombo: async (lineId) => {
      if (!get().isReady) await get().refresh();
      if (get().error && !get().isReady) return false;
      set({ isMutating: true, error: null, errorCode: null });
      try {
        const cart = await removeCartCombo(lineId, get().cart.revision);
        set({ cart, isReady: true, error: null, errorCode: null });
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error), errorCode: getErrorCode(error) });
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
