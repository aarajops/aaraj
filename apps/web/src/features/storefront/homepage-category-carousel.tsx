"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  getStorefrontCategoryHref,
  type CatalogPublishedCategoryOption,
} from "@aaraj/contracts";

export function HomepageCategoryCarousel({
  categories,
}: {
  categories: CatalogPublishedCategoryOption[];
}) {
  return (
    <Carousel aria-label="Shop by category" opts={{ align: "start" }}>
      <CarouselContent>
        {categories.map((category) => {
          if (!category.image) return null;
          return (
            <CarouselItem
              className="basis-4/5 sm:basis-1/2 lg:basis-1/3 xl:basis-1/5"
              key={category.id}
            >
              <Link
                className="group relative block aspect-[3/4] overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                href={getStorefrontCategoryHref(category.slug)}
              >
                <Image
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  height={category.image.height}
                  src={category.image.src}
                  unoptimized
                  width={category.image.width}
                />
                <span className="absolute inset-x-4 bottom-4 rounded-md bg-background px-3 py-3 text-center text-sm font-semibold uppercase tracking-wide text-foreground sm:text-base">
                  {category.name}
                </span>
              </Link>
            </CarouselItem>
          );
        })}
      </CarouselContent>
      <CarouselPrevious
        aria-label="Previous categories"
        className="left-2 border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden"
      />
      <CarouselNext
        aria-label="Next categories"
        className="right-2 border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden"
      />
    </Carousel>
  );
}
