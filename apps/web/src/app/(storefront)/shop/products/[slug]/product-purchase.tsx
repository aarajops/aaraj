"use client";

import { CatalogMeasurementKeySchema } from "@aaraj/contracts";
import type { CatalogProductDetail, CatalogSizeGuide } from "@aaraj/contracts";
import Image from "next/image";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddToCart } from "@/features/cart/add-to-cart";
import { CURRENCY } from "@aaraj/contracts";
import { catalogMeasurementLabels } from "@/features/catalog/size-guide-labels";
import { ProductPrice } from "@/features/catalog/product-price";
import { CircleHelp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { sendEcommerceEvent } from "@/features/analytics/gtm-ecommerce";
import { Badge } from "@/components/ui/badge";

type ProductVariant = CatalogProductDetail["variants"][number];

export function ProductPurchase({
  productId,
  productName,
  supportPhone,
  variants,
  sizeGuide,
  initialColor,
  initialSize,
}: {
  productId: string;
  productName: string;
  supportPhone: string | null;
  variants: ProductVariant[];
  sizeGuide: CatalogSizeGuide | null;
  initialColor?: string;
  initialSize?: string;
}) {
  const viewedItemKey = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const hasAnyStock = variants.some(({ inStock }) => inStock);
  const colors = uniqueOptions(variants.map(({ color }) => color));
  const color =
    findOption(colors, searchParams.get("color") ?? initialColor) ??
    (colors.length === 1 ? colors[0] : undefined) ??
    "";
  const sizeOrder = sizeGuide?.rows.map(({ sizeLabel }) => sizeLabel) ?? [];
  const initialSizeOptions = getSizeOptions(variants, color, sizeOrder);
  const size =
    findOption(initialSizeOptions, searchParams.get("size") ?? initialSize) ??
    (initialSizeOptions.length === 1 ? initialSizeOptions[0] : undefined) ??
    "";
  const matchingVariants = variants.filter(
    (variant) =>
      (!color || sameOption(variant.color, color)) &&
      (!size || sameOption(variant.sizeLabel, size)),
  );
  const selectedVariant =
    color && size
      ? matchingVariants.find(
          (variant) =>
            sameOption(variant.color, color) &&
            sameOption(variant.sizeLabel, size),
        )
      : undefined;
  const sizeOptions = getSizeOptions(variants, color, sizeOrder);
  const needsColor = colors.length > 1 && !color;
  const needsSize = sizeOptions.length > 1 && !size;
  const selectionPrompt = selectedVariant
    ? null
    : needsColor && needsSize
      ? "Select a color and size to continue."
      : needsColor
        ? "Select a color to continue."
        : needsSize
          ? "Select a size to continue."
          : null;
  const prices = [
    ...new Set(matchingVariants.map(({ price }) => price.amountBdt)),
  ].sort((left, right) => left - right);
  const displayedPrice =
    selectedVariant?.price ??
    (prices.length > 0 ? { amountBdt: prices[0]! } : null);
  const priceVaries = !selectedVariant && prices.length > 1;
  const lowestPriceVariants = matchingVariants.filter(
    (variant) => variant.price.amountBdt === prices[0],
  );
  const displayedCompareAtPrice = selectedVariant
    ? selectedVariant.compareAtPrice
    : getCommonCompareAtPrice(lowestPriceVariants);
  const viewItemPriceBdt =
    selectedVariant?.price.amountBdt ??
    (prices.length === 1 ? prices[0]! : null);
  const viewItemVariant = selectedVariant
    ? `${selectedVariant.color} / ${selectedVariant.sizeLabel}`
    : undefined;
  const viewItemId = selectedVariant?.id ?? productId;
  const viewItemKey = `${productId}:${viewItemId}`;
  const whatsappHref = supportPhone
    ? `https://wa.me/${supportPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
        [
          `Hi, I'm interested in ${productName}.`,
          color ? `Color: ${color}.` : null,
          size ? `Size: ${size}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      )}`
    : null;

  useEffect(() => {
    if (viewedItemKey.current === viewItemKey) return;
    const sent = sendEcommerceEvent("view_item", {
      currency: CURRENCY,
      ...(viewItemPriceBdt !== null ? { value: viewItemPriceBdt } : {}),
      items: [
        {
          item_id: viewItemId,
          item_name: productName,
          ...(viewItemVariant ? { item_variant: viewItemVariant } : {}),
          ...(viewItemPriceBdt !== null ? { price: viewItemPriceBdt } : {}),
          quantity: 1,
        },
      ],
    });
    if (sent) viewedItemKey.current = viewItemKey;
  }, [
    productId,
    productName,
    viewItemId,
    viewItemKey,
    viewItemPriceBdt,
    viewItemVariant,
  ]);

  function selectColor(nextColor: string) {
    const nextSizes = getSizeOptions(variants, nextColor, sizeOrder);
    const nextSize =
      findOption(nextSizes, size) ??
      (nextSizes.length === 1 ? nextSizes[0] : undefined) ??
      "";
    updateVariantUrl(nextColor, nextSize);
  }

  function selectSize(nextSize: string) {
    const matchingColors = uniqueOptions(
      variants
        .filter(
          (variant) =>
            sameOption(variant.sizeLabel, nextSize) && variant.inStock,
        )
        .map(({ color: variantColor }) => variantColor),
    );
    const nextColor =
      findOption(matchingColors, color) ??
      (matchingColors.length === 1 ? matchingColors[0] : undefined) ??
      "";
    updateVariantUrl(nextColor, nextSize);
  }

  if (variants.length === 0) return null;

  return (
    <div className="space-y-4">
      {displayedPrice && (
        <div aria-atomic="true" aria-live="polite">
          <ProductPrice
            compareAtPrice={displayedCompareAtPrice}
            price={displayedPrice}
            startingAt={priceVaries}
            size="prominent"
          />
        </div>
      )}

      <div className="space-y-3">
        {colors.length === 1 ? (
          <p className="text-sm">
            <span className="font-medium">Color:</span> {colors[0]}
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-2">
              {colors.map((option) => {
                const optionInStock = variants.some(
                  (variant) =>
                    sameOption(variant.color, option) && variant.inStock,
                );
                return (
                  <Button
                    aria-pressed={sameOption(color, option)}
                    disabled={!optionInStock}
                    key={option}
                    onClick={() => selectColor(option)}
                    type="button"
                    variant={sameOption(color, option) ? "default" : "outline"}
                  >
                    {option}
                    {!optionInStock && (
                      <span className="ml-1 text-xs">Stock out</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        )}

        {sizeOptions.length === 1 ? (
          <p className="text-sm">
            <span className="font-medium">Size:</span> {sizeOptions[0]}
          </p>
        ) : sizeOptions.length > 1 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium" id="size-options-label">
              Size
            </p>
            <div
              aria-labelledby="size-options-label"
              className="flex flex-wrap gap-2"
              role="group"
            >
              {sizeOptions.map((option) => {
                const optionInStock = variants.some(
                  (variant) =>
                    (!color || sameOption(variant.color, color)) &&
                    sameOption(variant.sizeLabel, option) &&
                    variant.inStock,
                );
                return (
                  <Button
                    aria-pressed={sameOption(size, option)}
                    disabled={!optionInStock}
                    key={option}
                    onClick={() => selectSize(option)}
                    type="button"
                    variant={sameOption(size, option) ? "default" : "outline"}
                  >
                    {option}
                    {!optionInStock && (
                      <span className="ml-1 text-xs">Stock out</span>
                    )}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {selectionPrompt && (
        <p className="text-sm text-muted-foreground">{selectionPrompt}</p>
      )}
      {hasAnyStock && selectedVariant && !selectedVariant.inStock && (
        <Badge variant="destructive">Stock out</Badge>
      )}
      <AddToCart
        variantId={selectedVariant?.inStock ? selectedVariant.id : null}
      />
      {whatsappHref && (
        <a
          className={buttonVariants({
            className:
              "w-full bg-whatsapp text-white hover:bg-whatsapp hover:brightness-90",
          })}
          href={whatsappHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Image
            alt=""
            aria-hidden="true"
            height={16}
            src="/whatsapp-glyph-white.svg"
            width={16}
          />
          Order On WhatsApp
        </a>
      )}
      {sizeGuide && <SizeGuideTable sizeGuide={sizeGuide} />}
    </div>
  );
}

function SizeGuideTable({ sizeGuide }: { sizeGuide: CatalogSizeGuide }) {
  const configuredMeasurementKeys = new Set(
    sizeGuide.rows[0]?.measurements.map(({ key }) => key) ?? [],
  );
  const measurementKeys = CatalogMeasurementKeySchema.options.filter((key) =>
    configuredMeasurementKeys.has(key),
  );

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Size guide</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table
          aria-describedby="size-guide-measurement-basis"
          className="min-w-max border-collapse text-left"
        >
          <TableCaption className="sr-only">
            Size measurements in inches
          </TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-auto px-3 py-2" scope="col">
                Measurement
              </TableHead>
              {sizeGuide.rows.map((row) => (
                <TableHead
                  className="h-auto px-3 py-2"
                  key={row.id}
                  scope="col"
                >
                  {row.sizeLabel}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {measurementKeys.map((key) => (
              <TableRow className="hover:bg-transparent" key={key}>
                <TableHead className="h-auto px-3 py-2 font-medium" scope="row">
                  {catalogMeasurementLabels[key].replace(
                    / (width|length)$/,
                    "",
                  )}
                </TableHead>
                {sizeGuide.rows.map((row) => {
                  const measurement = row.measurements.find(
                    (item) => item.key === key,
                  );
                  return (
                    <TableCell
                      className="px-3 py-2 text-muted-foreground"
                      key={row.id}
                    >
                      {measurement
                        ? formatMeasurement(measurement.valueIn)
                        : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-1 text-xs leading-none text-muted-foreground">
        <span id="size-guide-measurement-basis">
          {sizeGuide.measurementBasis === "garment" ? "Garment" : "Body"}{" "}
          measurements in inches
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="About size measurements"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <CircleHelp aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>
              {sizeGuide.measurementBasis === "garment"
                ? "Measurements are in inches and describe the garment, not body measurements."
                : "Measurements are in inches and describe body measurements, not garment dimensions."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function getSizeOptions(
  variants: ProductVariant[],
  color: string,
  sizeOrder: string[],
): string[] {
  const options = uniqueOptions(
    variants
      .filter((variant) => !color || sameOption(variant.color, color))
      .map(({ sizeLabel }) => sizeLabel),
  );
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
    return left.localeCompare(right);
  });
}

function getCommonCompareAtPrice(
  variants: ProductVariant[],
): ProductVariant["compareAtPrice"] {
  const compareAtPrice = variants[0]?.compareAtPrice ?? null;
  if (
    !compareAtPrice ||
    variants.some(
      (variant) =>
        variant.compareAtPrice?.amountBdt !== compareAtPrice.amountBdt,
    )
  ) {
    return null;
  }
  return compareAtPrice;
}

function uniqueOptions(values: string[]): string[] {
  const options = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeOption(value);
    if (!options.has(normalized)) options.set(normalized, value);
  }
  return [...options.values()];
}

function findOption(options: string[], value?: string): string | undefined {
  if (!value) return undefined;
  return options.find((option) => sameOption(option, value));
}

function sameOption(left: string, right: string): boolean {
  return normalizeOption(left) === normalizeOption(right);
}

function normalizeOption(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function updateVariantUrl(color: string, size: string) {
  const params = new URLSearchParams(window.location.search);
  if (color) params.set("color", color);
  else params.delete("color");
  if (size) params.set("size", size);
  else params.delete("size");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

function formatMeasurement(valueIn: string): string {
  const [whole, fraction = ""] = valueIn.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : (whole ?? valueIn);
}
