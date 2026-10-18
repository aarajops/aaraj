"use client";

import { useEffect, useState } from "react";
import type { PublicStorefrontBanners } from "@aaraj/contracts";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { StorefrontBannerImage } from "./storefront-banner-image";

const carouselOptions = { align: "start", loop: true } as const;

export function StorefrontBannerCarousel({
  slides,
}: {
  slides: PublicStorefrontBanners["banners"];
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (!api) return;

    const updateCurrentSlide = () => setCurrentSlide(api.selectedScrollSnap());
    updateCurrentSlide();
    api.on("select", updateCurrentSlide);

    return () => {
      api.off("select", updateCurrentSlide);
    };
  }, [api]);

  return (
    <div className="w-full">
      <Carousel
        aria-label="Featured promotions"
        opts={carouselOptions}
        setApi={setApi}
      >
        <CarouselContent className="-ml-0">
          {slides.map((banner, index) => (
            <CarouselItem
              aria-label={`Slide ${index + 1} of ${slides.length}`}
              className="pl-0"
              key={`${banner.desktop.id}-${index}`}
            >
              <StorefrontBannerImage
                banner={banner}
                fetchPriority={index === 0 ? "high" : "auto"}
                loading={index === 0 ? "eager" : "lazy"}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious
          aria-label="Previous promotion"
          className="left-4 border-0 bg-background/85 text-foreground shadow hover:bg-background"
        />
        <CarouselNext
          aria-label="Next promotion"
          className="right-4 border-0 bg-background/85 text-foreground shadow hover:bg-background"
        />
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          Slide {currentSlide + 1} of {slides.length}
        </span>
      </Carousel>
    </div>
  );
}
