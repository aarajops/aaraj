"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CatalogProductDetail } from "@aaraj/contracts";

type ProductImage = CatalogProductDetail["images"][number];
type ProductVariant = CatalogProductDetail["variants"][number];

export function ProductGallery({
  images,
  productName,
  variants,
}: {
  images: ProductImage[];
  productName: string;
  variants: ProductVariant[];
}) {
  const searchParams = useSearchParams();
  const selectedColor = searchParams.get("color");
  const selectedSize = searchParams.get("size");
  const matchingVariantIds = new Set(
    variants
      .filter(
        (variant) =>
          (!selectedColor || sameOption(variant.color, selectedColor)) &&
          (!selectedSize || sameOption(variant.sizeLabel, selectedSize)),
      )
      .map(({ id }) => id),
  );
  const variantImages = images.filter(
    (image) => image.variantId && matchingVariantIds.has(image.variantId),
  );
  const visibleImages =
    variantImages.length > 0
      ? [
          ...variantImages,
          ...images.filter((image) => image.variantId === null),
        ]
      : images;
  const selectionKey = `${selectedColor ?? ""}\u0000${selectedSize ?? ""}`;
  const [manualSelection, setManualSelection] = useState<{
    selectionKey: string;
    imageId: string;
  } | null>(null);
  const defaultImageId =
    !selectedColor && !selectedSize
      ? images[0]?.id
      : (variantImages[0]?.id ??
        images.find((image) => image.variantId === null)?.id ??
        images[0]?.id);
  const selectedImageId =
    manualSelection?.selectionKey === selectionKey
      ? manualSelection.imageId
      : defaultImageId;
  const selectedImage =
    visibleImages.find(({ id }) => id === selectedImageId) ?? visibleImages[0];

  if (!selectedImage) return null;

  return (
    <section aria-label={`${productName} product images`} className="min-w-0">
      <div className="overflow-hidden rounded-lg bg-muted/30">
        <Image
          alt={selectedImage.altText}
          className="h-auto w-full object-contain"
          fetchPriority="high"
          height={selectedImage.detail.height}
          loading="eager"
          src={selectedImage.detail.src}
          unoptimized
          width={selectedImage.detail.width}
        />
      </div>
      {visibleImages.length > 1 && (
        <ul
          aria-label="Choose a product image"
          className="mt-3 flex gap-3 overflow-x-auto pb-1"
        >
          {visibleImages.map((image, index) => (
            <li className="shrink-0" key={image.id}>
              <button
                aria-label={`Show image ${index + 1}: ${image.altText}`}
                aria-pressed={selectedImage.id === image.id}
                className={`block w-16 overflow-hidden rounded-md border bg-muted/30 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  selectedImage.id === image.id
                    ? "border-primary"
                    : "border-border hover:border-foreground/40"
                }`}
                onClick={() =>
                  setManualSelection({ selectionKey, imageId: image.id })
                }
                style={{
                  aspectRatio: `${image.card.width} / ${image.card.height}`,
                }}
                type="button"
              >
                <Image
                  alt=""
                  className="h-full w-full object-contain"
                  height={image.card.height}
                  loading="lazy"
                  src={image.card.src}
                  unoptimized
                  width={image.card.width}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sameOption(left: string, right: string): boolean {
  return (
    left.trim().toLocaleLowerCase("en-US") ===
    right.trim().toLocaleLowerCase("en-US")
  );
}
