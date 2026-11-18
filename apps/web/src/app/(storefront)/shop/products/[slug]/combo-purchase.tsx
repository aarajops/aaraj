"use client";

import { useMemo, useState } from "react";
import type { CatalogCombo } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldDescription } from "@/components/ui/field";
import { ProductPrice } from "@/features/catalog/product-price";
import { formatBdtPrice } from "@/lib/currency";
import { useCartSheet, useCartStore } from "@/features/cart/cart-provider";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
import { ArrowRight, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
type FlexibleChoice = {
  activeSize: string;
  colorsBySize: Record<string, string>;
};

export function ComboPurchase({
  productId,
  combo,
  inStock,
  initialSize,
}: {
  productId: string;
  combo: CatalogCombo;
  inStock: boolean;
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
  const [chosenColors, setChosenColors] = useState<Record<string, string>>({});
  const [flexibleChoices, setFlexibleChoices] = useState<
    Record<string, FlexibleChoice>
  >(() =>
    Object.fromEntries(
      combo.components.map(({ id }) => [
        id,
        { activeSize: "", colorsBySize: {} },
      ]),
    ),
  );
  const [status, setStatus] = useState<string | null>(null);

  const sharedSizes = useMemo(
    () => getSharedSizes(combo, chosenColors),
    [combo, chosenColors],
  );
  const selectedVariants = combo.components.map((component) => {
    if (combo.selectionMode === "fixed_combo") {
      return component.variants.find(
        (variant) =>
          variant.inStock &&
          sameOption(variant.color, component.fixedColor ?? "") &&
          sameOption(variant.sizeLabel, sharedSize),
      );
    }
    if (combo.selectionMode === "mix_colors_one_size") {
      const color = chosenColors[component.id];
      return component.variants.find(
        (variant) =>
          variant.inStock &&
          Boolean(color) &&
          sameOption(variant.color, color!) &&
          sameOption(variant.sizeLabel, sharedSize),
      );
    }
    const choice = flexibleChoices[component.id];
    const color = choice?.colorsBySize[choice.activeSize];
    return component.variants.find(
      (variant) =>
        variant.inStock &&
        Boolean(choice?.activeSize && color) &&
        sameOption(variant.sizeLabel, choice!.activeSize) &&
        sameOption(variant.color, color!),
    );
  });
  const complete = selectedVariants.every((variant) => variant !== undefined);
  const individualTotal = complete
    ? selectedVariants.reduce(
        (sum, variant) => sum + (variant?.price.amountBdt ?? 0),
        0,
      )
    : null;
  const compareAtPrice =
    individualTotal !== null && individualTotal > combo.price.amountBdt
      ? { amountBdt: individualTotal }
      : null;

  function chooseSharedColor(componentId: string, color: string) {
    setChosenColors((current) => {
      const next = { ...current };
      if (sameOption(next[componentId] ?? "", color)) delete next[componentId];
      else next[componentId] = color;
      return next;
    });
    setSharedSize("");
  }

  function chooseFlexibleSize(componentId: string, size: string) {
    setFlexibleChoices((current) => ({
      ...current,
      [componentId]: {
        activeSize: size,
        colorsBySize: current[componentId]?.colorsBySize ?? {},
      },
    }));
  }

  function toggleFlexibleColor(componentId: string, color: string) {
    setFlexibleChoices((current) => {
      const choice = current[componentId] ?? {
        activeSize: "",
        colorsBySize: {},
      };
      const colorsBySize = { ...choice.colorsBySize };
      if (sameOption(colorsBySize[choice.activeSize] ?? "", color)) {
        delete colorsBySize[choice.activeSize];
      } else {
        colorsBySize[choice.activeSize] = color;
      }
      return { ...current, [componentId]: { ...choice, colorsBySize } };
    });
  }

  async function addSelectedCombo(buyNow = false) {
    if (!complete || !inStock) return;
    setStatus(null);
    if (!isReady) {
      await refresh();
      return;
    }
    const added = await addCombo({
      productId,
      comboRevision: combo.revision,
      selections: combo.components.map((component, index) => ({
        componentId: component.id,
        variantId: selectedVariants[index]!.variantId,
      })),
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
              Individual prices for your selected products:{" "}
              {formatBdtPrice({ amountBdt: individualTotal })}
            </p>
          )}
      </div>

      <p className="text-sm font-medium">Sold as a complete set.</p>
      {!inStock && (
        <p className="text-sm text-destructive" role="status">
          This combo is currently out of stock.
        </p>
      )}

      <div className="space-y-4">
        {combo.components.map((component, index) => {
          const colors = uniqueOptions(
            component.variants.map(({ color }) => color),
          );
          const sizes = uniqueOptions(
            component.variants
              .filter(({ inStock: available }) => available)
              .map(({ sizeLabel }) => sizeLabel),
          );
          const flexibleChoice = flexibleChoices[component.id] ?? {
            activeSize: "",
            colorsBySize: {},
          };
          const activeFlexibleColor =
            flexibleChoice.colorsBySize[flexibleChoice.activeSize] ?? "";
          const colorOptions =
            combo.selectionMode === "fixed_combo"
              ? []
              : combo.selectionMode === "mix_colors_one_size"
                ? colors
                : uniqueOptions(
                    component.variants
                      .filter(
                        (variant) =>
                          variant.inStock &&
                          sameOption(
                            variant.sizeLabel,
                            flexibleChoice.activeSize,
                          ),
                      )
                      .map(({ color }) => color),
                  );
          return (
            <section
              aria-labelledby={`combo-component-${index}-title`}
              className="space-y-3 rounded-lg border border-border p-4"
              key={component.id}
            >
              <h2 className="font-medium" id={`combo-component-${index}-title`}>
                {component.productName}
              </h2>
              {combo.selectionMode === "fixed_combo" ? (
                <p className="text-sm text-muted-foreground">
                  {component.fixedColor}
                </p>
              ) : combo.selectionMode === "mix_sizes_and_colors" ? (
                <>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Size</legend>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map((size) => (
                        <Button
                          key={size}
                          aria-pressed={sameOption(
                            flexibleChoice.activeSize,
                            size,
                          )}
                          onClick={() => chooseFlexibleSize(component.id, size)}
                          type="button"
                          variant={
                            sameOption(flexibleChoice.activeSize, size)
                              ? "default"
                              : "outline"
                          }
                        >
                          {size}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                  {flexibleChoice.activeSize && (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Color</legend>
                      <div className="flex flex-wrap gap-2">
                        {colorOptions.map((color) => (
                          <Button
                            key={color}
                            aria-pressed={sameOption(
                              activeFlexibleColor,
                              color,
                            )}
                            onClick={() =>
                              toggleFlexibleColor(component.id, color)
                            }
                            type="button"
                            variant={
                              sameOption(activeFlexibleColor, color)
                                ? "default"
                                : "outline"
                            }
                          >
                            {color}
                          </Button>
                        ))}
                      </div>
                      <FieldDescription>
                        Choose the size first. Clicking the selected color again
                        clears it; choices for other sizes stay saved.
                      </FieldDescription>
                    </fieldset>
                  )}
                </>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Color</legend>
                  <div className="flex flex-wrap gap-2">
                    {colorOptions.map((color) => {
                      const selectedColor = chosenColors[component.id] ?? "";
                      const canCompleteAtColor =
                        getSharedSizes(combo, {
                          ...chosenColors,
                          [component.id]: color,
                        }).length > 0;
                      return (
                        <Button
                          key={color}
                          aria-pressed={sameOption(selectedColor, color)}
                          disabled={!canCompleteAtColor}
                          onClick={() => chooseSharedColor(component.id, color)}
                          type="button"
                          variant={
                            sameOption(selectedColor, color)
                              ? "default"
                              : "outline"
                          }
                        >
                          {color}
                        </Button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </section>
          );
        })}

        {combo.selectionMode !== "mix_sizes_and_colors" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {combo.selectionMode === "fixed_combo"
                ? "Shared size"
                : "One size for the whole combo"}
            </legend>
            <div className="flex flex-wrap gap-2">
              {sharedSizes.map((size) => (
                <Button
                  key={size}
                  aria-pressed={sameOption(sharedSize, size)}
                  onClick={() => setSharedSize(size)}
                  type="button"
                  variant={sameOption(sharedSize, size) ? "default" : "outline"}
                >
                  {size}
                </Button>
              ))}
            </div>
            {combo.selectionMode === "mix_colors_one_size" &&
              sharedSizes.length === 0 && (
                <FieldDescription>
                  Choose component colors that share an available size.
                </FieldDescription>
              )}
          </fieldset>
        )}
      </div>

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
          Select an available option for every product in the combo.
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
          <ArrowRight aria-hidden="true" />
          Buy now
        </Button>
      </div>
    </div>
  );
}

function getSharedSizes(combo: CatalogCombo, colors: Record<string, string>) {
  let shared: string[] | null = null;
  for (const component of combo.components) {
    const fixedColor =
      combo.selectionMode === "fixed_combo"
        ? component.fixedColor
        : colors[component.id];
    const sizes = uniqueOptions(
      component.variants
        .filter(
          (variant) =>
            variant.inStock &&
            (!fixedColor || sameOption(variant.color, fixedColor)),
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
  return (
    combo.components[0]?.variants
      .map(({ sizeLabel }) => sizeLabel)
      .filter(
        (size, index, all) =>
          all.findIndex((option) => sameOption(option, size)) === index &&
          Boolean(shared?.some((option) => sameOption(option, size))),
      ) ?? []
  );
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
