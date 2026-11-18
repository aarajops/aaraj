"use client";

import { useMemo, useState } from "react";
import type {
  CatalogCombo,
  CatalogComboVariantOption,
  CatalogSizeGuide,
} from "@aaraj/contracts";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useCartSheet, useCartStore } from "@/features/cart/cart-provider";
import { ProductPrice } from "@/features/catalog/product-price";
import { formatBdtPrice } from "@/lib/currency";
import { SizeGuideTable } from "./size-guide-table";

export function ComboPurchase({
  productId,
  combo,
  inStock,
  sizeGuide,
  initialSize,
}: {
  productId: string;
  combo: CatalogCombo;
  inStock: boolean;
  sizeGuide: CatalogSizeGuide | null;
  initialSize?: string;
}) {
  const router = useRouter();
  const { setOpen: setCartSheetOpen } = useCartSheet();
  const cart = useCartStore((state) => state.cart);
  const isReady = useCartStore((state) => state.isReady);
  const isLoading = useCartStore((state) => state.isLoading);
  const isMutating = useCartStore((state) => state.isMutating);
  const error = useCartStore((state) => state.error);
  const addCombo = useCartStore((state) => state.addCombo);
  const refresh = useCartStore((state) => state.refresh);
  const [sharedSize, setSharedSize] = useState(initialSize ?? "");
  const [activeSize, setActiveSize] = useState(initialSize ?? "");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string | null>(null);

  const sizeOrder = useMemo(
    () => sizeGuide?.rows.map(({ sizeLabel }) => sizeLabel) ?? [],
    [sizeGuide],
  );
  const sizeOptions = useMemo(
    () =>
      orderedSizes(
        combo.components.flatMap((component) =>
          component.variants.map(({ sizeLabel }) => sizeLabel),
        ),
        sizeOrder,
      ),
    [combo.components, sizeOrder],
  );
  const fixedSizeOptions = useMemo(
    () => getFixedComboSizes(combo, sizeOrder),
    [combo, sizeOrder],
  );
  const sharedSizeOptions =
    combo.selectionMode === "fixed_combo" ? fixedSizeOptions : sizeOptions;
  const availableSharedSizes = sharedSizeOptions.filter((size) =>
    combo.selectionMode === "fixed_combo"
      ? combo.components.every((component) =>
          component.variants.some(
            (variant) =>
              variant.availableQuantity > 0 &&
              sameOption(variant.sizeLabel, size) &&
              sameOption(variant.color, component.fixedColor ?? ""),
          ),
        )
      : availableAtSharedSize(combo, size) >= combo.itemCount,
  );

  const selectedCount = Object.values(quantities).reduce(
    (total, quantity) => total + quantity,
    0,
  );
  const countAtSize = (size: string) =>
    combo.components.reduce(
      (total, component) =>
        total +
        component.variants.reduce(
          (subtotal, variant) =>
            subtotal +
            (sameOption(variant.sizeLabel, size)
              ? (quantities[variant.variantId] ?? 0)
              : 0),
          0,
        ),
      0,
    );

  const selectedItems =
    combo.selectionMode === "fixed_combo"
      ? combo.components.flatMap((component) => {
          const variant = component.variants.find(
            (candidate) =>
              sameOption(candidate.color, component.fixedColor ?? "") &&
              sameOption(candidate.sizeLabel, sharedSize),
          );
          return variant ? [{ component, variant, quantity: 1 }] : [];
        })
      : combo.components.flatMap((component) =>
          component.variants.flatMap((variant) => {
            const quantity = quantities[variant.variantId] ?? 0;
            if (
              quantity < 1 ||
              (combo.selectionMode === "mix_colors_one_size" &&
                !sameOption(variant.sizeLabel, sharedSize))
            ) {
              return [];
            }
            return [{ component, variant, quantity }];
          }),
        );
  const selectedTotal = selectedItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const complete =
    combo.selectionMode === "fixed_combo"
      ? selectedItems.length === combo.itemCount && Boolean(sharedSize)
      : selectedTotal === combo.itemCount &&
        (combo.selectionMode !== "mix_colors_one_size" || Boolean(sharedSize));
  const individualTotal = complete
    ? selectedItems.reduce(
        (total, { variant, quantity }) =>
          total + variant.price.amountBdt * quantity,
        0,
      )
    : null;
  const compareAtPrice =
    individualTotal !== null && individualTotal > combo.price.amountBdt
      ? { amountBdt: individualTotal }
      : null;
  const mixSummaryText = sizeOptions
    .map((size) => ({ size, quantity: countAtSize(size) }))
    .filter(({ quantity }) => quantity > 0)
    .map(({ size, quantity }) => `${quantity}×${size}`)
    .join(" · ");

  function setVariantQuantity(
    variant: CatalogComboVariantOption,
    value: number,
  ) {
    const nextQuantity = Math.min(
      variant.availableQuantity,
      combo.itemCount,
      Math.max(0, value),
    );
    setQuantities((current) => {
      const next = { ...current };
      if (nextQuantity === 0) delete next[variant.variantId];
      else next[variant.variantId] = nextQuantity;
      return next;
    });
  }

  function toggleVariant(variant: CatalogComboVariantOption) {
    const currentQuantity = quantities[variant.variantId] ?? 0;
    if (currentQuantity > 0) {
      setVariantQuantity(variant, 0);
      return;
    }
    if (selectedCount < combo.itemCount && variant.availableQuantity > 0) {
      setVariantQuantity(variant, 1);
    }
  }

  function changeSharedSize(size: string) {
    setSharedSize((current) => {
      const next = sameOption(current, size) ? "" : size;
      if (combo.selectionMode === "mix_colors_one_size" && next !== current) {
        setQuantities({});
      }
      return next;
    });
  }

  async function addSelectedCombo(buyNow = false) {
    if (!complete || !inStock) return;
    setStatus(null);
    if (!isReady) {
      await refresh();
      return;
    }
    const selections = selectedItems.flatMap(
      ({ component, variant, quantity }) =>
        Array.from({ length: quantity }, () => ({
          componentId: component.id,
          variantId: variant.variantId,
        })),
    );
    const added = await addCombo({
      productId,
      comboRevision: combo.revision,
      selections,
      quantity: 1,
    });
    if (!added) return;
    if (buyNow) router.push("/checkout");
    else {
      setStatus("Combo added to your cart.");
      setCartSheetOpen(true);
    }
  }

  const alreadyInCart = cart.combos.some(
    (line) => line.productId === productId,
  );
  const quantityLimitReached =
    cart.combos
      .filter((line) => line.productId === productId)
      .reduce((quantity, line) => quantity + line.quantity, 0) >=
    MAX_CART_QUANTITY_PER_VARIANT;
  const blocked =
    !complete || !inStock || quantityLimitReached || isMutating || isLoading;

  return (
    <div className="space-y-5">
      <div aria-live="polite" aria-atomic="true">
        <ProductPrice
          price={{ amountBdt: combo.price.amountBdt }}
          compareAtPrice={compareAtPrice}
          size="prominent"
        />
        {individualTotal !== null &&
          individualTotal > combo.price.amountBdt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Individual prices for your selected items:{" "}
              {formatBdtPrice({ amountBdt: individualTotal })}
            </p>
          )}
      </div>

      <p className="text-sm font-medium">Sold as a complete set.</p>
      {combo.selectionMode === "fixed_combo" && (
        <p className="text-sm text-muted-foreground">
          Choose one size for every item in the set.
        </p>
      )}
      {combo.selectionMode === "mix_colors_one_size" && (
        <p className="text-sm text-muted-foreground">
          Choose one size, then select exactly {combo.itemCount} items from the
          available colors.
        </p>
      )}
      {combo.selectionMode === "mix_sizes_and_colors" && (
        <p className="text-sm text-muted-foreground">
          Choose sizes and colors for exactly {combo.itemCount} items. Your
          selections stay saved as you switch sizes.
        </p>
      )}
      {!inStock && (
        <p className="text-sm text-destructive" role="status">
          This combo is currently out of stock.
        </p>
      )}

      {combo.selectionMode === "fixed_combo" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Size for the whole set
          </legend>
          <div className="flex flex-wrap gap-2">
            {sharedSizeOptions.map((size) => {
              const selected = sameOption(sharedSize, size);
              const available = availableSharedSizes.some((option) =>
                sameOption(option, size),
              );
              return (
                <Button
                  key={size}
                  aria-label={`Choose size ${size}`}
                  aria-pressed={selected}
                  disabled={!available && !selected}
                  onClick={() => changeSharedSize(size)}
                  type="button"
                  variant={selected ? "default" : "outline"}
                >
                  {size}
                </Button>
              );
            })}
          </div>
          {sharedSizeOptions.length > availableSharedSizes.length && (
            <FieldDescription>
              Sizes without a complete set in stock cannot be selected.
            </FieldDescription>
          )}
        </fieldset>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {combo.selectionMode === "mix_colors_one_size"
                ? "One size for the whole set"
                : "Choose a size to select items"}
            </legend>
            <div className="flex flex-wrap gap-2">
              {sizeOptions.map((size) => {
                const selected =
                  combo.selectionMode === "mix_colors_one_size"
                    ? sameOption(sharedSize, size)
                    : sameOption(activeSize, size);
                const count = countAtSize(size);
                const available =
                  combo.selectionMode === "mix_colors_one_size"
                    ? availableAtSharedSize(combo, size) >= combo.itemCount
                    : availableAtSharedSize(combo, size) > 0;
                return (
                  <Button
                    key={size}
                    aria-label={`Choose size ${size}`}
                    aria-pressed={selected}
                    disabled={!available && !selected}
                    onClick={() => {
                      if (combo.selectionMode === "mix_colors_one_size") {
                        changeSharedSize(size);
                      } else {
                        setActiveSize(size);
                      }
                    }}
                    type="button"
                    variant={selected ? "default" : "outline"}
                  >
                    {size}
                    {count > 0 ? ` · ${count}` : ""}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          {combo.selectionMode === "mix_sizes_and_colors" && (
            <section
              aria-label="Combo selection progress"
              className="space-y-2 border border-border p-3"
            >
              <p className="font-medium">
                {selectedCount} of {combo.itemCount} selected
              </p>
              {selectedCount === combo.itemCount && (
                <p className="text-sm text-muted-foreground">
                  Remove a selected item to change your mix.
                </p>
              )}
              {mixSummaryText && (
                <p className="text-sm text-muted-foreground">
                  Your mix: {mixSummaryText}
                </p>
              )}
              <div
                aria-label={`${selectedCount} of ${combo.itemCount} items selected`}
                aria-valuemax={combo.itemCount}
                aria-valuemin={0}
                aria-valuenow={selectedCount}
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
              >
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{
                    width: `${(selectedCount / combo.itemCount) * 100}%`,
                  }}
                />
              </div>
            </section>
          )}

          {combo.selectionMode === "mix_colors_one_size" && sharedSize && (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Choose any {combo.itemCount} in {sharedSize}
                {selectedTotal > 0 ? ` · ${selectedTotal} selected` : ""}
              </p>
              {selectedTotal === combo.itemCount && (
                <p className="text-sm text-muted-foreground">
                  Remove a selected item to change your mix.
                </p>
              )}
            </div>
          )}
          {combo.selectionMode === "mix_sizes_and_colors" && activeSize && (
            <p className="text-sm font-medium">Choose items in {activeSize}</p>
          )}

          {(combo.selectionMode === "mix_colors_one_size"
            ? sharedSize
            : activeSize) && (
            <div className="space-y-4">
              {combo.components.map((component) => {
                const options = component.variants
                  .filter((variant) =>
                    sameOption(
                      variant.sizeLabel,
                      combo.selectionMode === "mix_colors_one_size"
                        ? sharedSize
                        : activeSize,
                    ),
                  )
                  .sort((left, right) =>
                    left.color.localeCompare(right.color, "en", {
                      sensitivity: "base",
                    }),
                  );
                if (options.length === 0) return null;
                return (
                  <section
                    aria-label={component.productName}
                    className="space-y-2"
                    key={component.id}
                  >
                    <h2 className="text-sm font-medium">
                      {component.productName}
                    </h2>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {options.map((variant) => {
                        const quantity = quantities[variant.variantId] ?? 0;
                        const canAdd =
                          variant.availableQuantity > quantity &&
                          selectedCount < combo.itemCount;
                        const canChangeSelection =
                          quantity > 0 ||
                          (variant.availableQuantity > 0 &&
                            selectedCount < combo.itemCount);
                        return (
                          <article
                            aria-label={`${component.productName}, ${variant.color}, size ${variant.sizeLabel}`}
                            className={`rounded-md border p-2 ${quantity > 0 ? "border-primary" : "border-border"}`}
                            key={variant.variantId}
                          >
                            <button
                              aria-pressed={quantity > 0}
                              className="min-h-12 w-full text-left text-sm"
                              disabled={!canChangeSelection}
                              onClick={() => toggleVariant(variant)}
                              type="button"
                            >
                              <span className="block font-medium">
                                {variant.color}
                              </span>
                              {variant.availableQuantity === 0 &&
                                quantity === 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    Sold out
                                  </span>
                                )}
                            </button>
                            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                              <Button
                                aria-label={`Remove one ${component.productName} ${variant.color} ${variant.sizeLabel}`}
                                disabled={quantity === 0}
                                onClick={() =>
                                  setVariantQuantity(variant, quantity - 1)
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                −
                              </Button>
                              <span aria-live="polite">{quantity}</span>
                              <Button
                                aria-label={`Add one ${component.productName} ${variant.color} ${variant.sizeLabel}`}
                                disabled={!canAdd}
                                onClick={() =>
                                  setVariantQuantity(variant, quantity + 1)
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                +
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          className="w-full"
          disabled={blocked || !isReady || Boolean(error)}
          onClick={() => void addSelectedCombo()}
          size="lg"
          type="button"
          variant="outline"
        >
          <ShoppingCart aria-hidden="true" />
          {quantityLimitReached
            ? "Limit reached"
            : alreadyInCart
              ? "Add another combo"
              : "Add to cart"}
        </Button>
        <Button
          className="w-full"
          disabled={blocked || !isReady || Boolean(error)}
          onClick={() => void addSelectedCombo(true)}
          size="lg"
          type="button"
        >
          <ArrowRight aria-hidden="true" /> Buy now
        </Button>
      </div>
      {!complete && (
        <p className="text-sm text-muted-foreground">
          {combo.selectionMode === "fixed_combo"
            ? "Choose an available shared size to continue."
            : `Choose exactly ${combo.itemCount} available items to continue.`}
        </p>
      )}
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
      {!isReady && !error && (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner aria-hidden="true" />
          {isLoading ? "Loading your cart…" : "Preparing your cart…"}
        </p>
      )}
      {!isReady && error && (
        <Button
          className="w-full"
          disabled={isLoading}
          onClick={() => void refresh()}
          type="button"
          variant="outline"
        >
          {isLoading ? "Loading your cart…" : "Retry cart load"}
        </Button>
      )}
      {sizeGuide && (
        <div className="border-t border-border pt-5">
          <SizeGuideTable sizeGuide={sizeGuide} />
        </div>
      )}
      <div
        aria-label="Quick combo purchase"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-card px-5 py-3 shadow-lg sm:hidden"
        role="group"
      >
        <ProductPrice
          price={{ amountBdt: combo.price.amountBdt }}
          compareAtPrice={compareAtPrice}
          size="prominent"
        />
        <Button
          className="w-auto"
          disabled={blocked || !isReady || Boolean(error)}
          onClick={() => void addSelectedCombo(true)}
          size="lg"
          type="button"
        >
          <ArrowRight aria-hidden="true" /> Buy now
        </Button>
      </div>
    </div>
  );
}

function availableAtSharedSize(combo: CatalogCombo, size: string) {
  return combo.components.reduce(
    (total, component) =>
      total +
      component.variants.reduce(
        (subtotal, variant) =>
          subtotal +
          (sameOption(variant.sizeLabel, size) ? variant.availableQuantity : 0),
        0,
      ),
    0,
  );
}

function getFixedComboSizes(combo: CatalogCombo, sizeOrder: string[]) {
  let shared: string[] | null = null;
  for (const component of combo.components) {
    const sizes = uniqueOptions(
      component.variants
        .filter((variant) =>
          sameOption(variant.color, component.fixedColor ?? ""),
        )
        .map(({ sizeLabel }) => sizeLabel),
    );
    shared =
      shared === null
        ? sizes
        : shared.filter((size) =>
            sizes.some((option) => sameOption(option, size)),
          );
  }
  return orderedSizes(shared ?? [], sizeOrder);
}

function orderedSizes(values: string[], sizeOrder: string[]) {
  const options = uniqueOptions(values);
  const order = new Map(
    sizeOrder.map((label, index) => [normalizeOption(label), index]),
  );
  return options.sort((left, right) => {
    const leftOrder = order.get(normalizeOption(left));
    const rightOrder = order.get(normalizeOption(right));
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return left.localeCompare(right, "en", { numeric: true });
  });
}

function uniqueOptions(values: string[]) {
  return values.filter(
    (value, index) =>
      values.findIndex((candidate) => sameOption(candidate, value)) === index,
  );
}

function sameOption(left: string, right: string) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function normalizeOption(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
