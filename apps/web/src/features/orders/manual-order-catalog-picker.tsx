"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CatalogManagedProductDetailSchema,
  CatalogProductPageSchema,
  MAX_CART_QUANTITY_PER_VARIANT,
  type CatalogCombo,
  type CatalogManagedProductDetail,
  type ManualOrderInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBdtPrice } from "@/lib/currency";
import {
  fetchManagedProductDetail,
  fetchManagedProducts,
} from "@/features/catalog/catalog-client";

export type ManualVariantLine = {
  variantId: string;
  productId: string;
  productName: string;
  color: string;
  sizeLabel: string;
  unitPriceBdt: number;
  quantity: number;
};

type ManualComboLine = ManualOrderInput["combos"][number];
type ComboChoice = { componentId: string; variantId: string };
type ComboOption = {
  componentId: string;
  componentName: string;
  variantId: string;
  color: string;
  sizeLabel: string;
  availableQuantity: number;
};

type ManualOrderCatalogPickerProps = {
  editingLine: ManualVariantLine | null;
  existingVariantQuantities: Record<string, number>;
  lineLimitReached: boolean;
  onAddVariant: (line: ManualVariantLine) => void;
  onAddCombo: (
    line: ManualComboLine,
    productName: string,
    unitPriceBdt: number,
  ) => void;
  onCancelEdit: () => void;
  onUpdateVariant: (previousVariantId: string, line: ManualVariantLine) => void;
};

export function ManualOrderCatalogPicker(props: ManualOrderCatalogPickerProps) {
  const key = props.editingLine
    ? `edit:${props.editingLine.variantId}:${props.editingLine.quantity}`
    : "add";
  return <ManualOrderCatalogPickerContent key={key} {...props} />;
}

function ManualOrderCatalogPickerContent({
  editingLine,
  existingVariantQuantities,
  lineLimitReached,
  onAddVariant,
  onAddCombo,
  onCancelEdit,
  onUpdateVariant,
}: ManualOrderCatalogPickerProps) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    query: string;
    products: Array<{ id: string; name: string; priceBdt: number | null }>;
  } | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    editingLine?.productId ?? null,
  );
  const [product, setProduct] = useState<CatalogManagedProductDetail | null>(
    null,
  );
  const [loadingProduct, setLoadingProduct] = useState(Boolean(editingLine));
  const [productError, setProductError] = useState(false);
  const [variantId, setVariantId] = useState(editingLine?.variantId ?? "");
  const [variantQuantity, setVariantQuantity] = useState(
    editingLine?.quantity ?? 1,
  );
  const [comboQuantity, setComboQuantity] = useState(1);
  const [comboChoices, setComboChoices] = useState<Array<ComboChoice | null>>(
    [],
  );
  const [searchError, setSearchError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const searchId = useId();
  const variantIdInput = useId();

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetchManagedProducts(
        { limit: 10, offset: 0, search, status: "published" },
        controller.signal,
      )
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = CatalogProductPageSchema.safeParse(
            await response.json(),
          );
          if (!result.success) throw new Error();
          if (!controller.signal.aborted) {
            setSearchResults({
              query: search,
              products: result.data.products.map(({ id, name, price }) => ({
                id,
                name,
                priceBdt: price?.amountBdt ?? null,
              })),
            });
            setSearchError(false);
          }
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setSearchResults({ query: search, products: [] });
            setSearchError(true);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function resetProduct(preserveVariantQuantity = false) {
    request.current?.abort();
    setSelectedProductId(null);
    setProduct(null);
    setVariantId("");
    if (!preserveVariantQuantity) setVariantQuantity(1);
    setComboQuantity(1);
    setComboChoices([]);
    setQuery("");
  }

  async function chooseProduct(productId: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSelectedProductId(productId);
    setProduct(null);
    setVariantId("");
    setComboChoices([]);
    setLoadingProduct(true);
    setProductError(false);
    try {
      const response = await fetchManagedProductDetail(
        productId,
        controller.signal,
      );
      if (!response.ok) throw new Error();
      const result = CatalogManagedProductDetailSchema.safeParse(
        await response.json(),
      );
      if (!result.success) throw new Error();
      if (!controller.signal.aborted) {
        setProduct(result.data);
        if (result.data.combo) {
          setComboChoices(
            Array.from({ length: result.data.combo.itemCount }, () => null),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setProductError(true);
      }
    } finally {
      if (!controller.signal.aborted) setLoadingProduct(false);
    }
  }

  useEffect(() => {
    if (!editingLine) return;
    const controller = new AbortController();
    request.current = controller;
    void fetchManagedProductDetail(editingLine.productId, controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = CatalogManagedProductDetailSchema.safeParse(
          await response.json(),
        );
        if (!result.success) throw new Error();
        if (!controller.signal.aborted) {
          setProduct(result.data);
          if (result.data.combo) {
            setComboChoices(
              Array.from({ length: result.data.combo.itemCount }, () => null),
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof Error && error.name === "AbortError") &&
          !controller.signal.aborted
        ) {
          setProductError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProduct(false);
      });
    return () => controller.abort();
  }, [editingLine]);

  const activeProduct = product?.id === selectedProductId ? product : null;
  const matchingResults =
    searchResults?.query === query.trim() ? searchResults.products : [];
  const searchPending =
    query.trim().length >= 2 &&
    searchResults?.query !== query.trim() &&
    !searchError;
  const selectedVariant = activeProduct?.variants.find(
    (variant) => variant.id === variantId && variant.isActive && variant.price,
  );
  function getAvailableQuantity(selectedId: string) {
    const alreadySelected = Math.max(
      0,
      (existingVariantQuantities[selectedId] ?? 0) -
        (editingLine?.variantId === selectedId ? editingLine.quantity : 0),
    );
    return Math.max(0, MAX_CART_QUANTITY_PER_VARIANT - alreadySelected);
  }
  const availableLineQuantity = getAvailableQuantity(variantId);
  const combo = activeProduct?.combo ?? null;
  const comboOptions = combo ? getComboOptions(combo) : [];
  const resolvedComboChoices = comboChoices.map((choice) =>
    choice
      ? (comboOptions.find(
          (option) =>
            option.componentId === choice.componentId &&
            option.variantId === choice.variantId,
        ) ?? null)
      : null,
  );
  const comboComplete =
    Boolean(combo) &&
    resolvedComboChoices.length === combo?.itemCount &&
    resolvedComboChoices.every((choice) => choice !== null);
  const comboInStock =
    comboComplete &&
    comboOptionsHaveStock(resolvedComboChoices, comboOptions, comboQuantity);

  function comboOptionsForSlot(slot: number): ComboOption[] {
    if (!combo) return [];
    const sameSizeChoice = resolvedComboChoices.find(
      (choice, index) => choice && index !== slot,
    );
    const slotOptions =
      combo.selectionMode === "fixed_combo"
        ? comboOptions.filter(
            (option) =>
              option.componentId === combo.components[slot]?.id &&
              option.color.toLocaleLowerCase() ===
                combo.components[slot]?.fixedColor?.toLocaleLowerCase(),
          )
        : comboOptions;
    return slotOptions.filter((option) => {
      if (sameSizeChoice && option.sizeLabel !== sameSizeChoice.sizeLabel) {
        return false;
      }
      const chosenElsewhere = resolvedComboChoices.filter(
        (choice, index) =>
          index !== slot && choice?.variantId === option.variantId,
      ).length;
      return chosenElsewhere + 1 <= option.availableQuantity / comboQuantity;
    });
  }

  function selectComboChoice(slot: number, value: string) {
    if (!combo) return;
    const [componentId, selectedId] = value.split(":");
    const selected =
      componentId && selectedId ? { componentId, variantId: selectedId } : null;
    setComboChoices((current) => {
      const next = [...current];
      next[slot] = selected;
      if (combo.selectionMode === "mix_colors_one_size" && slot === 0) {
        for (let index = 1; index < next.length; index += 1) {
          if (
            next[index] &&
            comboOptions.find(
              (option) => option.variantId === next[index]?.variantId,
            )?.sizeLabel !==
              comboOptions.find(
                (option) => option.variantId === selected?.variantId,
              )?.sizeLabel
          ) {
            next[index] = null;
          }
        }
      }
      return next;
    });
  }

  function addVariant() {
    if (!activeProduct || !selectedVariant?.price || !variantId) return;
    const line = {
      variantId: selectedVariant.id,
      productId: activeProduct.id,
      productName: activeProduct.name,
      color: selectedVariant.color,
      sizeLabel: selectedVariant.sizeLabel,
      unitPriceBdt: selectedVariant.price.amountBdt,
      quantity: Math.min(variantQuantity, availableLineQuantity),
    };
    if (editingLine) {
      onUpdateVariant(editingLine.variantId, line);
    } else {
      onAddVariant(line);
    }
    resetProduct();
  }

  function cancelEdit() {
    resetProduct();
    onCancelEdit();
  }

  function addCombo() {
    if (!activeProduct || !combo || !comboInStock || editingLine) return;
    onAddCombo(
      {
        lineId: window.crypto.randomUUID(),
        productId: activeProduct.id,
        comboRevision: combo.revision,
        quantity: comboQuantity,
        selections: resolvedComboChoices.map((choice) => ({
          componentId: choice!.componentId,
          variantId: choice!.variantId,
        })),
      },
      activeProduct.name,
      combo.price.amountBdt,
    );
    resetProduct();
  }

  return (
    <div className="grid gap-4">
      {!selectedProductId ? (
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor={searchId}>
            Search published products
          </label>
          <Input
            autoComplete="off"
            id={searchId}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchResults(null);
              setSearchError(false);
            }}
            placeholder="Product name"
            type="search"
            value={query}
          />
          {query.trim().length < 2 && (
            <p className="text-sm text-muted-foreground">
              Enter at least 2 characters.
            </p>
          )}
          {searchPending && (
            <p className="text-sm text-muted-foreground" role="status">
              Searching products…
            </p>
          )}
          {!searchPending &&
            query.trim().length >= 2 &&
            matchingResults.length === 0 &&
            !searchError && (
              <p className="text-sm text-muted-foreground" role="status">
                No products found.
              </p>
            )}
          {searchError && (
            <p className="text-sm text-destructive" role="alert">
              Product search failed. Try again.
            </p>
          )}
          {matchingResults.length > 0 && (
            <div className="grid divide-y rounded-lg border border-border">
              {matchingResults.map((result) => (
                <button
                  className="flex min-h-12 items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-muted"
                  key={result.id}
                  onClick={() => void chooseProduct(result.id)}
                  type="button"
                >
                  <span className="font-medium">{result.name}</span>
                  {result.priceBdt !== null && (
                    <span className="shrink-0 text-muted-foreground">
                      {formatBdtPrice({ amountBdt: result.priceBdt })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">
                {activeProduct?.name ??
                  (loadingProduct ? "Loading product…" : "Product")}
              </h3>
              {productError && (
                <p className="mt-1 text-sm text-destructive" role="alert">
                  Product details could not be loaded.
                </p>
              )}
            </div>
            <div className="flex gap-1">
              {editingLine && (
                <Button
                  onClick={() => resetProduct(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Change product
                </Button>
              )}
              <Button
                onClick={() => (editingLine ? cancelEdit() : resetProduct())}
                size="sm"
                type="button"
                variant="ghost"
              >
                {editingLine ? "Cancel edit" : "Change"}
              </Button>
            </div>
          </div>

          {activeProduct && !activeProduct.combo && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor={variantIdInput}
              >
                Color and size
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  id={variantIdInput}
                  onChange={(event) => {
                    const nextVariantId = event.target.value;
                    setVariantId(nextVariantId);
                    const availableQuantity =
                      getAvailableQuantity(nextVariantId);
                    if (availableQuantity > 0) {
                      setVariantQuantity((current) =>
                        Math.min(current, availableQuantity),
                      );
                    }
                  }}
                  value={variantId}
                >
                  <option value="">Choose a variant</option>
                  {activeProduct.variants
                    .filter((variant) => variant.isActive && variant.price)
                    .map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.color} · {variant.sizeLabel} ·{" "}
                        {formatBdtPrice(variant.price!)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Quantity
                <Input
                  disabled={!selectedVariant || availableLineQuantity < 1}
                  max={availableLineQuantity}
                  min={1}
                  onChange={(event) =>
                    setVariantQuantity(
                      Math.min(
                        availableLineQuantity,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    )
                  }
                  type="number"
                  value={variantQuantity}
                />
              </label>
              <Button
                disabled={
                  (lineLimitReached && !editingLine) ||
                  !selectedVariant ||
                  availableLineQuantity < 1
                }
                onClick={addVariant}
                type="button"
              >
                {editingLine ? "Update item" : "Add item"}
              </Button>
              {variantId && availableLineQuantity < 1 && (
                <p
                  className="text-sm text-destructive sm:col-span-3"
                  role="status"
                >
                  This variant has reached the order quantity limit.
                </p>
              )}
            </div>
          )}

          {activeProduct && combo && editingLine && (
            <p className="text-sm text-muted-foreground" role="status">
              Choose a single item product to replace this variant.
            </p>
          )}

          {activeProduct && combo && !editingLine && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {combo.selectionMode === "fixed_combo"
                  ? "Choose one size for every item in this set."
                  : combo.selectionMode === "mix_colors_one_size"
                    ? `Choose one size and select ${combo.itemCount} items.`
                    : `Choose ${combo.itemCount} items across sizes and colors.`}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {comboChoices.map((choice, slot) => {
                  const options = comboOptionsForSlot(slot);
                  const currentValue = choice
                    ? `${choice.componentId}:${choice.variantId}`
                    : "";
                  return (
                    <label
                      className="grid gap-2 text-sm font-medium"
                      key={slot}
                    >
                      Item {slot + 1}
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        onChange={(event) =>
                          selectComboChoice(slot, event.target.value)
                        }
                        value={currentValue}
                      >
                        <option value="">Choose an item</option>
                        {options.map((option) => (
                          <option
                            key={`${option.componentId}:${option.variantId}`}
                            value={`${option.componentId}:${option.variantId}`}
                          >
                            {option.componentName} · {option.color} ·{" "}
                            {option.sizeLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-2 text-sm font-medium">
                  Combo quantity
                  <Input
                    max={MAX_CART_QUANTITY_PER_VARIANT}
                    min={1}
                    onChange={(event) =>
                      setComboQuantity(
                        Math.min(
                          MAX_CART_QUANTITY_PER_VARIANT,
                          Math.max(1, Number(event.target.value) || 1),
                        ),
                      )
                    }
                    type="number"
                    value={comboQuantity}
                  />
                </label>
                <Button
                  disabled={lineLimitReached || !comboComplete || !comboInStock}
                  onClick={addCombo}
                  type="button"
                >
                  Add combo · {formatBdtPrice(combo.price)}
                </Button>
                {comboComplete && !comboInStock && (
                  <p
                    className="basis-full text-sm text-destructive"
                    role="status"
                  >
                    The selected combo quantity exceeds available stock.
                  </p>
                )}
              </div>
            </div>
          )}
          {lineLimitReached && (
            <p className="text-sm text-destructive" role="status">
              The Order item limit has been reached.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function getComboOptions(combo: CatalogCombo): ComboOption[] {
  return combo.components.flatMap((component) =>
    component.variants.map((variant) => ({
      componentId: component.id,
      componentName: component.productName,
      variantId: variant.variantId,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      availableQuantity: variant.availableQuantity,
    })),
  );
}

function comboOptionsHaveStock(
  choices: readonly (ComboOption | null)[],
  options: readonly ComboOption[],
  quantity: number,
): boolean {
  const counts = new Map<string, number>();
  for (const choice of choices) {
    if (!choice) return false;
    counts.set(choice.variantId, (counts.get(choice.variantId) ?? 0) + 1);
  }
  return [...counts].every(([variantId, count]) => {
    const option = options.find(
      (candidate) => candidate.variantId === variantId,
    );
    return Boolean(
      option &&
      count * quantity <= option.availableQuantity &&
      count * quantity <= MAX_CART_QUANTITY_PER_VARIANT,
    );
  });
}
