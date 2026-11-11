import type { ReactNode } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

export function RelatedProductsCarousel({
  categoryName,
  children,
}: {
  categoryName: string;
  children: ReactNode;
}) {
  return (
    <Carousel
      aria-labelledby="related-products-heading"
      className="relative"
      opts={{ align: "start" }}
    >
      <div className="mb-5 flex items-center justify-between gap-4 sm:mb-6">
        <h2
          className="text-xl font-semibold tracking-tight sm:text-2xl"
          id="related-products-heading"
        >
          More in {categoryName}
        </h2>
        <div className="flex shrink-0 gap-2">
          <CarouselPrevious
            aria-label="Previous related products"
            className="static inset-auto my-0 size-9 rounded-md"
          />
          <CarouselNext
            aria-label="Next related products"
            className="static inset-auto my-0 size-9 rounded-md"
          />
        </div>
      </div>

      <CarouselContent className="-ml-3">{children}</CarouselContent>
    </Carousel>
  );
}
