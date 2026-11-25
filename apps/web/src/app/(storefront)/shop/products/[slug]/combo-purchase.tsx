"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type {
  CatalogCombo,
  CatalogComboThumbnail,
  CatalogComboVariantOption,
  CatalogPrice,
  CatalogSizeGuide,
} from "@aaraj/contracts";
import {
  getComboRegularPrice,
  MAX_CART_QUANTITY_PER_VARIANT,
} from "@aaraj/contracts";
import { ArrowRight, Package, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useCartSheet, useCartStore } from "@/features/cart/cart-provider";
import { ProductPrice } from "@/features/catalog/product-price";
import { SizeGuideTable } from "./size-guide-table";

export function ComboPurchase({
  productId,
  combo,
  initialCompareAtPrice,
  inStock,
  sizeGuide,
  initialSize,
}: {
  productId: string;
  combo: CatalogCombo;
  initialCompareAtPrice: CatalogPrice | null;
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
  const [activeColor, setActiveColor] = useState("");
  const [prefetchColor, setPrefetchColor] = useState<string | null>(null);
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
  const mixColorOptions = useMemo(() => {
    const byColor = new Map<
      string,
      { color: string; selectedCount: number; availableQuantity: number }
    >();
    for (const component of combo.components) {
      for (const variant of component.variants) {
        const key = normalizeOption(variant.color);
        const summary = byColor.get(key) ?? {
          color: variant.color,
          selectedCount: 0,
          availableQuantity: 0,
        };
        summary.selectedCount += quantities[variant.variantId] ?? 0;
        summary.availableQuantity += variant.availableQuantity;
        byColor.set(key, summary);
      }
    }
    return [...byColor.values()].sort((left, right) =>
      left.color.localeCompare(right.color, "en", { sensitivity: "base" }),
    );
  }, [combo.components, quantities]);
  const fixedSizeOptions = useMemo(
    () => getFixedComboSizes(combo, sizeOrder),
    [combo, sizeOrder],
  );
  const sharedSizeOptions =
    combo.selectionMode === "fixed_combo" ? fixedSizeOptions : sizeOptions;
  const availableSharedSizes =
    combo.selectionMode === "fixed_combo"
      ? sharedSizeOptions.filter((size) => hasAvailableFixedSize(combo, size))
      : [];

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
  const activeMixColor =
    mixColorOptions.find(({ color }) => sameOption(color, activeColor))
      ?.color ??
    mixColorOptions.find(({ availableQuantity }) => availableQuantity > 0)
      ?.color ??
    mixColorOptions[0]?.color ??
    "";

  const prefetchColorThumbnails = (color: string) => {
    if (
      sameOption(color, activeMixColor) ||
      !mixColorOptions.some(
        (option) =>
          sameOption(option.color, color) && option.availableQuantity > 0,
      )
    ) {
      return;
    }

    setPrefetchColor(color);
  };

  const thumbnailsToPrefetch =
    prefetchColor && !sameOption(prefetchColor, activeMixColor)
      ? combo.components.flatMap((component) => {
          const hasColorVariants = component.variants.some((variant) =>
            sameOption(variant.color, prefetchColor),
          );
          const thumbnail = hasColorVariants
            ? getComponentThumbnail(component, prefetchColor)
            : undefined;
          return thumbnail ? [thumbnail] : [];
        })
      : [];

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
  const displayedCompareAtPrice = complete
    ? getComboRegularPrice(
        combo,
        selectedItems.flatMap(({ variant, quantity }) =>
          Array.from({ length: quantity }, () => variant.variantId),
        ),
      )
    : initialCompareAtPrice;
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
    <div className="space-y-4">
      {thumbnailsToPrefetch.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 -z-10 size-px overflow-hidden opacity-0"
        >
          {thumbnailsToPrefetch.map((thumbnail) => (
            <Image
              key={thumbnail.card.src}
              alt=""
              className="size-px"
              decoding="async"
              fetchPriority="low"
              height={thumbnail.card.height}
              loading="eager"
              sizes="(min-width: 640px) 72px, 64px"
              src={thumbnail.card.src}
              width={thumbnail.card.width}
            />
          ))}
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        <ProductPrice
          price={{ amountBdt: combo.price.amountBdt }}
          compareAtPrice={displayedCompareAtPrice}
          size="prominent"
        />
      </div>

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
      {!inStock && (
        <p className="text-sm text-destructive" role="status">
          This combo is currently out of stock.
        </p>
      )}

      {combo.selectionMode === "fixed_combo" ? (
        <fieldset className="space-y-3">
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
      ) : combo.selectionMode === "mix_sizes_and_colors" ? (
        <div className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="flex w-full flex-col gap-1 text-sm font-medium lg:flex-row lg:items-center lg:justify-between">
              <span>
                Color
                <span className="font-normal text-muted-foreground">
                  {` (Choose ${combo.itemCount} items across colors and sizes)`}
                </span>
              </span>
              <span
                aria-live="polite"
                className="self-end font-normal text-muted-foreground lg:self-auto"
              >
                {selectedCount} of {combo.itemCount} selected
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {mixColorOptions.map(
                ({
                  color,
                  selectedCount: colorSelectedCount,
                  availableQuantity,
                }) => {
                  const selected = sameOption(activeMixColor, color);
                  const available = availableQuantity > 0;
                  return (
                    <Button
                      key={color}
                      aria-label={`Choose color ${color}${colorSelectedCount > 0 ? `, ${colorSelectedCount} selected` : ""}${!available ? ", unavailable" : ""}`}
                      aria-pressed={selected}
                      className={
                        !available && colorSelectedCount === 0
                          ? "relative border-border/50 text-muted-foreground/50 disabled:opacity-100"
                          : undefined
                      }
                      disabled={!available && colorSelectedCount === 0}
                      onClick={() => setActiveColor(color)}
                      onFocus={() => prefetchColorThumbnails(color)}
                      onPointerEnter={() => prefetchColorThumbnails(color)}
                      type="button"
                      variant={selected ? "default" : "outline"}
                    >
                      {color}
                      {colorSelectedCount > 0 ? ` · ${colorSelectedCount}` : ""}
                      {!available && colorSelectedCount === 0 && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/40"
                        ></span>
                      )}
                    </Button>
                  );
                },
              )}
            </div>
          </fieldset>

          {activeMixColor && (
            <div
              aria-label={`Products available in ${activeMixColor}`}
              className="divide-y divide-border overflow-hidden rounded-lg border border-border"
              role="region"
            >
              {combo.components.map((component) => {
                const colorVariants = component.variants.filter((variant) =>
                  sameOption(variant.color, activeMixColor),
                );
                const options = orderedSizes(
                  colorVariants.map(({ sizeLabel }) => sizeLabel),
                  sizeOrder,
                ).flatMap((size) =>
                  colorVariants.filter((variant) =>
                    sameOption(variant.sizeLabel, size),
                  ),
                );
                if (options.length === 0) return null;
                const thumbnail = getComponentThumbnail(
                  component,
                  activeMixColor,
                );

                return (
                  <section
                    aria-label={component.productName}
                    className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3"
                    key={component.id}
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:contents">
                      <ComboComponentThumbnail thumbnail={thumbnail} />
                      <h3
                        className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 sm:hidden"
                        title={component.productName}
                      >
                        {component.productName}
                      </h3>
                    </div>
                    <div className="@container min-w-0 flex-1 space-y-2">
                      <h3
                        className="hidden line-clamp-2 text-sm font-semibold leading-5 sm:block"
                        title={component.productName}
                      >
                        {component.productName}
                      </h3>
                      <fieldset className="min-w-0">
                        <legend className="sr-only">
                          Sizes in {activeMixColor} for {component.productName}
                        </legend>
                        <div className="grid grid-cols-2 gap-1.5 @sm:grid-cols-4">
                          {options.map((variant) => {
                            const quantity = quantities[variant.variantId] ?? 0;
                            const canAdd =
                              variant.availableQuantity > quantity &&
                              selectedCount < combo.itemCount;
                            const unavailable =
                              variant.availableQuantity === 0 && quantity === 0;

                            return (
                              <article
                                aria-label={`${component.productName}, ${activeMixColor}, size ${variant.sizeLabel}${unavailable ? ", unavailable" : ""}`}
                                className={`relative min-h-10 min-w-0 rounded-md border motion-safe:transition-colors motion-safe:duration-200 ${quantity > 0 ? "border-primary bg-primary/5" : "border-border"}`}
                                key={variant.variantId}
                              >
                                <span
                                  className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap text-sm font-medium motion-safe:transition-[left,translate] motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none ${quantity > 0 ? "left-1.5 translate-x-0" : "left-1/2 -translate-x-1/2"} ${unavailable || (!canAdd && quantity === 0) ? "text-muted-foreground/50" : ""}`}
                                >
                                  {variant.sizeLabel}
                                  {unavailable && (
                                    <span
                                      aria-hidden="true"
                                      className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/40"
                                    />
                                  )}
                                </span>
                                {quantity === 0 &&
                                  variant.availableQuantity > 0 && (
                                    <Button
                                      className="absolute inset-0 z-0 h-full min-h-10 w-full rounded-md border-0 bg-transparent p-0 shadow-none hover:bg-muted/50"
                                      disabled={!canAdd}
                                      onClick={() =>
                                        setVariantQuantity(variant, 1)
                                      }
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      <span className="sr-only">
                                        Add one {component.productName}{" "}
                                        {activeMixColor} size{" "}
                                        {variant.sizeLabel}
                                      </span>
                                    </Button>
                                  )}
                                {quantity > 0 && (
                                  <div className="absolute top-1/2 right-1.5 z-20 flex -translate-y-1/2 items-center gap-0.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200">
                                    <Button
                                      aria-label={`Remove one ${component.productName} ${activeMixColor} size ${variant.sizeLabel}`}
                                      onClick={() =>
                                        setVariantQuantity(
                                          variant,
                                          quantity - 1,
                                        )
                                      }
                                      className="h-6 w-6 p-0"
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      −
                                    </Button>
                                    <span
                                      aria-live="polite"
                                      className="min-w-4 text-center text-xs tabular-nums"
                                    >
                                      {quantity}
                                    </span>
                                    <Button
                                      aria-label={`Add one ${component.productName} ${activeMixColor} size ${variant.sizeLabel}`}
                                      disabled={!canAdd}
                                      onClick={() =>
                                        setVariantQuantity(
                                          variant,
                                          quantity + 1,
                                        )
                                      }
                                      className="h-6 w-6 p-0"
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      +
                                    </Button>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </fieldset>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              One size for the whole set
            </legend>
            <div className="flex flex-wrap gap-2">
              {sizeOptions.map((size) => {
                const selected = sameOption(sharedSize, size);
                const count = countAtSize(size);
                const available =
                  availableAtSharedSize(combo, size) >= combo.itemCount;
                return (
                  <Button
                    key={size}
                    aria-label={`Choose size ${size}${count > 0 ? `, ${count} selected` : ""}`}
                    aria-pressed={selected}
                    disabled={!available && !selected}
                    onClick={() => changeSharedSize(size)}
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

          {sharedSize && (
            <p className="text-sm font-medium">
              Choose {combo.itemCount} items in {sharedSize}
              {selectedTotal > 0 ? ` · ${selectedTotal} selected` : ""}
            </p>
          )}
          {sharedSize && (
            <div className="space-y-6">
              {combo.components.map((component) => {
                const options = component.variants
                  .filter((variant) =>
                    sameOption(variant.sizeLabel, sharedSize),
                  )
                  .sort((left, right) =>
                    left.color.localeCompare(right.color, "en", {
                      sensitivity: "base",
                    }),
                  );
                return (
                  <section
                    aria-label={component.productName}
                    className="min-w-0"
                    key={component.id}
                  >
                    <Trace className="gap-3">
                      <TraceLine className="w-full text-foreground">
                        <TraceIcon>
                          <Package />
                        </TraceIcon>
                        <TraceTitle
                          className="font-semibold whitespace-normal"
                          title={component.productName}
                        >
                          {component.productName}
                        </TraceTitle>
                      </TraceLine>
                      <div className="ml-[7px] min-w-0 border-l border-border pl-4 text-foreground">
                        {options.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No options available in {sharedSize}.
                          </p>
                        ) : (
                          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
                            {options.map((variant) => {
                              const quantity =
                                quantities[variant.variantId] ?? 0;
                              const canAdd =
                                variant.availableQuantity > quantity &&
                                selectedCount < combo.itemCount;
                              const optionLabel = (
                                <span
                                  className={`relative inline-block max-w-full truncate text-sm font-medium ${variant.availableQuantity === 0 && quantity === 0 ? "text-muted-foreground/50" : ""}`}
                                >
                                  {variant.color}
                                  {variant.availableQuantity === 0 &&
                                    quantity === 0 && (
                                      <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-muted-foreground/40"
                                      />
                                    )}
                                </span>
                              );

                              return quantity === 0 &&
                                variant.availableQuantity > 0 ? (
                                <Button
                                  aria-label={`Add one ${component.productName} ${variant.color} size ${variant.sizeLabel}`}
                                  className="h-auto min-h-10 w-full min-w-0 justify-between gap-3 border px-4 py-3 text-foreground shadow-none"
                                  disabled={!canAdd}
                                  key={variant.variantId}
                                  onClick={() => setVariantQuantity(variant, 1)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <span className="min-w-0 flex-1 text-left">
                                    {optionLabel}
                                  </span>
                                  <span className="shrink-0 text-sm font-medium">
                                    Add
                                  </span>
                                </Button>
                              ) : (
                                <article
                                  aria-label={`${component.productName}, ${variant.color}, size ${variant.sizeLabel}${variant.availableQuantity === 0 && quantity === 0 ? ", unavailable" : ""}`}
                                  className={`flex min-w-0 items-center justify-between gap-3 rounded-md border px-4 py-3 ${quantity > 0 ? "border-primary bg-primary/5" : "border-border"}`}
                                  key={variant.variantId}
                                >
                                  <div className="min-w-0 flex-1">
                                    {optionLabel}
                                  </div>
                                  {quantity > 0 ? (
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        aria-label={`Remove one ${component.productName} ${variant.color} size ${variant.sizeLabel}`}
                                        onClick={() =>
                                          setVariantQuantity(
                                            variant,
                                            quantity - 1,
                                          )
                                        }
                                        className="size-8 p-0"
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                      >
                                        −
                                      </Button>
                                      <span
                                        aria-live="polite"
                                        className="min-w-5 text-center text-sm tabular-nums"
                                      >
                                        {quantity}
                                      </span>
                                      <Button
                                        aria-label={`Add one ${component.productName} ${variant.color} size ${variant.sizeLabel}`}
                                        disabled={!canAdd}
                                        onClick={() =>
                                          setVariantQuantity(
                                            variant,
                                            quantity + 1,
                                          )
                                        }
                                        className="size-8 p-0"
                                        size="sm"
                                        type="button"
                                        variant="ghost"
                                      >
                                        +
                                      </Button>
                                    </div>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </Trace>
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
          disabled={blocked || Boolean(error)}
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
          disabled={blocked || Boolean(error)}
          onClick={() => void addSelectedCombo(true)}
          size="lg"
          type="button"
        >
          <ArrowRight aria-hidden="true" /> Buy now
        </Button>
      </div>
      {!complete && combo.selectionMode !== "mix_sizes_and_colors" && (
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
      {!isReady && isLoading && !error && (
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
          compareAtPrice={displayedCompareAtPrice}
          size="prominent"
        />
        <Button
          className="w-auto"
          disabled={blocked || Boolean(error)}
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

function ComboComponentThumbnail({
  thumbnail,
}: {
  thumbnail: CatalogComboThumbnail | undefined;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <AspectRatio
      className="w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/30 sm:w-18"
      ratio="square"
    >
      {thumbnail && thumbnail.card.src !== failedSrc ? (
        <Image
          alt=""
          className="object-contain"
          fill
          loading="lazy"
          onError={() => setFailedSrc(thumbnail.card.src)}
          sizes="(min-width: 640px) 72px, 64px"
          src={thumbnail.card.src}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Package aria-hidden="true" className="size-5" />
        </div>
      )}
    </AspectRatio>
  );
}

function getComponentThumbnail(
  component: CatalogCombo["components"][number],
  color: string,
) {
  return (
    component.thumbnails?.find(
      (thumbnail) =>
        thumbnail.color !== null && sameOption(thumbnail.color, color),
    ) ??
    component.thumbnails?.find(
      ({ color: thumbnailColor }) => thumbnailColor === null,
    )
  );
}

function hasAvailableFixedSize(combo: CatalogCombo, size: string) {
  const demandByVariant = new Map<
    string,
    { demand: number; availableQuantity: number }
  >();
  for (const component of combo.components) {
    const variant = component.variants.find(
      (candidate) =>
        sameOption(candidate.sizeLabel, size) &&
        sameOption(candidate.color, component.fixedColor ?? ""),
    );
    if (!variant) return false;
    const current = demandByVariant.get(variant.variantId);
    demandByVariant.set(variant.variantId, {
      demand: (current?.demand ?? 0) + 1,
      availableQuantity: variant.availableQuantity,
    });
  }
  return [...demandByVariant.values()].every(
    ({ demand, availableQuantity }) => demand <= availableQuantity,
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
