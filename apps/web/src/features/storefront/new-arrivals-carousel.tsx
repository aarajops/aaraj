"use client";

import type { ReactNode } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

export function NewArrivalsCarousel({ children }: { children: ReactNode }) {
  return (
    <Carousel aria-label="New arrivals" opts={{ align: "start" }}>
      <CarouselContent>{children}</CarouselContent>
      <CarouselPrevious
        aria-label="Previous new arrivals"
        className="left-2 hidden rounded-none border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden sm:inline-flex"
      />
      <CarouselNext
        aria-label="Next new arrivals"
        className="right-2 hidden rounded-none border-0 bg-background/90 text-foreground shadow hover:bg-background disabled:hidden sm:inline-flex"
      />
    </Carousel>
  );
}
