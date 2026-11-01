"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CatalogManagedProductDetailSchema,
  CatalogProductPageSchema,
  MAX_CART_QUANTITY_PER_VARIANT,
  type CatalogManagedProductDetail,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBdtPrice } from "@/lib/currency";
import {
  fetchManagedProductDetail,
  fetchManagedProducts,
} from "./catalog-client";

export type CatalogVariantSelection = {
  variantId: string;
  productId: string;
  productName: string;
  color: string;
  sizeLabel: string;
  unitPriceBdt: number;
  currentQuantity: number;
};

type ProductResult = { id: string; name: string; price: number | null };
type ExistingVariant = {
  variantId: string;
  quantity: number;
  unitPriceBdt: number;
};

export function CatalogVariantSearch({
  disabled = false,
  existingVariants = [],
  lineLimitReached = false,
  onSelect,
}: {
  disabled?: boolean;
  existingVariants?: ExistingVariant[];
  lineLimitReached?: boolean;
  onSelect: (variant: CatalogVariantSelection | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [product, setProduct] = useState<CatalogManagedProductDetail | null>(
    null,
  );
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState(false);
  const [selection, setSelection] = useState<CatalogVariantSelection | null>(
    null,
  );
  const productRequest = useRef<AbortController | null>(null);
  const searchId = useId();

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) {
      setProducts([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    const controller = new AbortController();
    setProducts([]);
    setSearching(true);
    setSearchError(false);
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
          setProducts(
            result.data.products.map(({ id, name, price }) => ({
              id,
              name,
              price: price?.amountBdt ?? null,
            })),
          );
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setSearchError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  async function chooseProduct(productId: string) {
    productRequest.current?.abort();
    const controller = new AbortController();
    productRequest.current = controller;
    setSelectedProductId(productId);
    setProduct(null);
    setSelection(null);
    onSelect(null);
    setProductLoading(true);
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
      if (!controller.signal.aborted) setProduct(result.data);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setProductError(true);
      }
    } finally {
      if (!controller.signal.aborted) setProductLoading(false);
    }
  }

  function changeProduct() {
    productRequest.current?.abort();
    setSelectedProductId(null);
    setProduct(null);
    setSelection(null);
    setQuery("");
    onSelect(null);
  }

  const activeProduct = product?.id === selectedProductId ? product : null;

  function selectVariant(variantId: string) {
    const variant = activeProduct?.variants.find(
      (candidate) => candidate.id === variantId,
    );
    if (!activeProduct || !variant?.isActive || variant.price === null) return;
    const existingVariant = existingVariants.find(
      (candidate) => candidate.variantId === variant.id,
    );
    if (
      (existingVariant?.quantity ?? 0) >= MAX_CART_QUANTITY_PER_VARIANT ||
      (!existingVariant && lineLimitReached)
    ) {
      return;
    }
    const selected = {
      variantId: variant.id,
      productId: activeProduct.id,
      productName: activeProduct.name,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      unitPriceBdt: existingVariant?.unitPriceBdt ?? variant.price.amountBdt,
      currentQuantity: existingVariant?.quantity ?? 0,
    };
    setSelection(selected);
    onSelect(selected);
  }

  if (selection) {
    return (
      <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0 text-sm">
          <p className="font-medium">{selection.productName}</p>
          <p className="text-muted-foreground">
            {selection.color} · {selection.sizeLabel} ·{" "}
            {selection.currentQuantity > 0 ? "Order price · " : ""}
            {formatBdtPrice({ amountBdt: selection.unitPriceBdt })}
          </p>
        </div>
        <Button
          disabled={disabled}
          onClick={changeProduct}
          size="sm"
          type="button"
          variant="ghost"
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      {!selectedProductId ? (
        <div className="grid min-w-0 gap-2">
          <label className="text-sm font-medium" htmlFor={searchId}>
            Search products
          </label>
          <Input
            autoComplete="off"
            disabled={disabled}
            id={searchId}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Enter a product name"
            type="search"
            value={query}
          />
          {searching && (
            <p className="text-sm text-muted-foreground" role="status">
              Searching products…
            </p>
          )}
          {searchError && (
            <p className="text-sm text-destructive" role="alert">
              Product search failed.
            </p>
          )}
          {!searching && !searchError && query.trim().length < 2 && (
            <p className="text-sm text-muted-foreground">
              Enter at least 2 characters.
            </p>
          )}
          {!searching &&
            !searchError &&
            query.trim().length >= 2 &&
            products.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No products found.
              </p>
            )}
          {products.length > 0 && (
            <ul
              aria-label="Product search results"
              className="min-w-0 overflow-hidden rounded-lg border border-border"
            >
              {products.map((item) => (
                <li
                  className="min-w-0 border-b border-border last:border-b-0"
                  key={item.id}
                >
                  <Button
                    className="h-auto min-w-0 w-full justify-between gap-3 rounded-none px-3 py-2 text-left"
                    disabled={disabled}
                    onClick={() => void chooseProduct(item.id)}
                    type="button"
                    variant="ghost"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.price !== null && (
                      <span className="shrink-0 text-muted-foreground">
                        From {formatBdtPrice({ amountBdt: item.price })}
                      </span>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {activeProduct?.name ?? "Product variants"}
            </p>
            <Button
              disabled={disabled}
              onClick={changeProduct}
              size="sm"
              type="button"
              variant="ghost"
            >
              Change product
            </Button>
          </div>
          {productLoading && (
            <p className="text-sm text-muted-foreground" role="status">
              Loading variants…
            </p>
          )}
          {productError && (
            <p className="text-sm text-destructive" role="alert">
              Product variants could not be loaded. Try another product.
            </p>
          )}
          {activeProduct && activeProduct.variants.length > 0 && (
            <Select
              disabled={disabled}
              onValueChange={(value) => {
                if (typeof value === "string") selectVariant(value);
              }}
            >
              <SelectTrigger aria-label="Choose a product variant">
                <SelectValue placeholder="Choose color and size" />
              </SelectTrigger>
              <SelectContent>
                {activeProduct.variants.map((variant) => {
                  const existingVariant = existingVariants.find(
                    ({ variantId }) => variantId === variant.id,
                  );
                  const unavailable =
                    !variant.isActive || variant.price === null;
                  const quantityLimitReached =
                    (existingVariant?.quantity ?? 0) >=
                    MAX_CART_QUANTITY_PER_VARIANT;
                  const orderLimitReached =
                    !existingVariant && lineLimitReached;
                  return (
                    <SelectItem
                      disabled={
                        unavailable || quantityLimitReached || orderLimitReached
                      }
                      key={variant.id}
                      value={variant.id}
                    >
                      {variant.color} · {variant.sizeLabel}
                      {variant.price !== null
                        ? ` · ${formatBdtPrice({ amountBdt: existingVariant?.unitPriceBdt ?? variant.price.amountBdt })}`
                        : " · Unavailable"}
                      {existingVariant
                        ? ` · On order · Qty ${existingVariant.quantity}`
                        : ""}
                      {quantityLimitReached ? " · Maximum quantity" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          {activeProduct?.variants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This product has no variants available for sale.
            </p>
          )}
          {activeProduct &&
            activeProduct.variants.length > 0 &&
            activeProduct.variants.every((variant) => {
              const existingVariant = existingVariants.find(
                ({ variantId }) => variantId === variant.id,
              );
              return (
                !variant.isActive ||
                variant.price === null ||
                (existingVariant?.quantity ?? 0) >=
                  MAX_CART_QUANTITY_PER_VARIANT ||
                (!existingVariant && lineLimitReached)
              );
            }) && (
              <p className="text-sm text-muted-foreground">
                {lineLimitReached
                  ? "The order item limit has been reached."
                  : "No variants are available to add."}
              </p>
            )}
        </div>
      )}
    </div>
  );
}
