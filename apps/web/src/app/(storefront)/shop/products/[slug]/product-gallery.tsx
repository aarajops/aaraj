"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CatalogProductDetail } from "@aaraj/contracts";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

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
  const [api, setApi] = useState<CarouselApi>();
  const matchingVariantIds = useMemo(
    () =>
      new Set(
        variants
          .filter(
            (variant) =>
              (!selectedColor || sameOption(variant.color, selectedColor)) &&
              (!selectedSize || sameOption(variant.sizeLabel, selectedSize)),
          )
          .map(({ id }) => id),
      ),
    [selectedColor, selectedSize, variants],
  );
  const variantImages = useMemo(
    () =>
      images.filter(
        (image) => image.variantId && matchingVariantIds.has(image.variantId),
      ),
    [images, matchingVariantIds],
  );
  const visibleImages = useMemo(
    () =>
      variantImages.length > 0
        ? [
            ...variantImages,
            ...images.filter((image) => image.variantId === null),
          ]
        : images,
    [images, variantImages],
  );
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
  const selectedImageIndex = Math.max(
    visibleImages.findIndex(({ id }) => id === selectedImage?.id),
    0,
  );

  useEffect(() => {
    if (!api) return;

    const updateSelection = () => {
      const image = visibleImages[api.selectedScrollSnap()];
      if (image) {
        setManualSelection({ selectionKey, imageId: image.id });
      }
    };

    api.on("select", updateSelection);
    return () => {
      api.off("select", updateSelection);
    };
  }, [api, selectionKey, visibleImages]);

  useEffect(() => {
    if (!api || !selectedImage) return;
    if (api.selectedScrollSnap() !== selectedImageIndex) {
      api.scrollTo(selectedImageIndex);
    }
  }, [api, selectedImage, selectedImageIndex]);

  if (!selectedImage) return null;

  return (
    <section className="min-w-0">
      <Carousel
        aria-label={`${productName} product images`}
        opts={{ align: "start" }}
        setApi={setApi}
      >
        <CarouselContent className="-ml-0">
          {visibleImages.map((image, index) => (
            <CarouselItem
              aria-label={`Image ${index + 1} of ${visibleImages.length}`}
              className="pl-0"
              key={image.id}
            >
              <div className="overflow-hidden rounded-lg bg-muted/30">
                <Image
                  alt={image.altText}
                  className="block h-auto w-full object-contain"
                  fetchPriority={index === selectedImageIndex ? "high" : "auto"}
                  height={image.detail.height}
                  loading={index === selectedImageIndex ? "eager" : "lazy"}
                  src={image.detail.src}
                  unoptimized
                  width={image.detail.width}
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        {visibleImages.length > 1 && (
          <>
            <CarouselPrevious
              aria-label="Previous product image"
              className="left-3 border-0 bg-background/85 text-foreground shadow hover:bg-background"
            />
            <CarouselNext
              aria-label="Next product image"
              className="right-3 border-0 bg-background/85 text-foreground shadow hover:bg-background"
            />
          </>
        )}
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          Image {selectedImageIndex + 1} of {visibleImages.length}
        </span>
      </Carousel>
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
