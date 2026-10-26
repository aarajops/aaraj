"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageIcon } from "lucide-react";
import type { CatalogPublishedCategoryOption } from "@aaraj/contracts";

function CategoryImage({
  category,
}: {
  category: CatalogPublishedCategoryOption;
}) {
  const [imageStatus, setImageStatus] = useState<
    "loading" | "loaded" | "error"
  >(category.image ? "loading" : "error");

  return (
    <AspectRatio className="overflow-hidden rounded-xl bg-muted" ratio={1}>
      {category.image && imageStatus !== "error" && (
        <Image
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          height={category.image.height}
          onError={() => setImageStatus("error")}
          onLoad={() => setImageStatus("loaded")}
          src={category.image.src}
          unoptimized
          width={category.image.width}
        />
      )}
      {category.image && imageStatus === "loading" && (
        <Skeleton aria-hidden="true" className="absolute inset-0 rounded-xl" />
      )}
      {imageStatus === "error" && (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <ImageIcon aria-hidden="true" className="size-8" />
        </div>
      )}
    </AspectRatio>
  );
}

export function HomepageCategoryCarousel({
  categories,
}: {
  categories: CatalogPublishedCategoryOption[];
}) {
  const mobileItemBasis =
    categories.length > 2
      ? "basis-1/3"
      : categories.length === 2
        ? "basis-1/2"
        : "basis-full";

  return (
    <Carousel aria-label="Shop by category" opts={{ align: "start" }}>
      <CarouselContent>
        {categories.map((category) => {
          return (
            <CarouselItem
              className={`${mobileItemBasis} sm:basis-1/2 lg:basis-1/3 xl:basis-1/5 2xl:basis-1/6`}
              key={category.id}
            >
              <Link
                className="group flex flex-col gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                href={`/shop/categories/${category.slug}`}
              >
                <CategoryImage category={category} />
                <h3 className="text-center text-sm font-medium uppercase tracking-wide text-foreground">
                  {category.name}
                </h3>
              </Link>
            </CarouselItem>
          );
        })}
      </CarouselContent>
      <CarouselPrevious
        aria-label="Previous categories"
        className="left-2 hidden border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden sm:inline-flex"
      />
      <CarouselNext
        aria-label="Next categories"
        className="right-2 hidden border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden sm:inline-flex"
      />
    </Carousel>
  );
}
