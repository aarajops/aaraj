import Link from "next/link";
import type {
  CatalogAudience,
  CatalogPublishedProductListItem,
} from "@aaraj/contracts";
import { ProductCard } from "@/features/catalog/product-card";
import { CarouselItem } from "@/components/ui/carousel";
import { NewArrivalsCarousel } from "./new-arrivals-carousel";

const audiences: { value: CatalogAudience; label: string }[] = [
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "unisex", label: "Unisex" },
];

export function NewArrivalsSection({
  audience,
  products,
  unavailable = false,
}: {
  audience: CatalogAudience;
  products: CatalogPublishedProductListItem[];
  unavailable?: boolean;
}) {
  return (
    <section aria-labelledby="new-arrivals-title" className="py-10 sm:py-14">
      <div className="relative mb-6 flex min-h-9 items-center justify-center sm:mb-7">
        <h2
          className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          id="new-arrivals-title"
        >
          New Arrivals
        </h2>
        <Link
          className="absolute right-0 rounded-sm text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/shop"
        >
          See all
        </Link>
      </div>

      <nav
        aria-label="Shop new arrivals by audience"
        className="mb-7 flex flex-wrap justify-center gap-2.5 sm:mb-8 sm:gap-4"
      >
        {audiences.map(({ value, label }) => {
          const selected = value === audience;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={`rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-foreground hover:border-primary hover:text-primary"
              }`}
              href={`/?audience=${value}`}
              key={value}
              prefetch={false}
              scroll={false}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {products.length > 0 ? (
        <NewArrivalsCarousel>
          {products.map((product) => (
            <CarouselItem
              className="basis-[78%] min-[480px]:basis-1/2 lg:basis-1/3 xl:basis-1/5"
              key={product.id}
            >
              <ProductCard headingLevel="h3" imageRatio={1} product={product} />
            </CarouselItem>
          ))}
        </NewArrivalsCarousel>
      ) : (
        <p
          className="py-8 text-center text-sm text-muted-foreground"
          role="status"
        >
          {unavailable
            ? "New arrivals are temporarily unavailable. Please try again shortly."
            : "No new arrivals are available for this audience yet."}
        </p>
      )}
    </section>
  );
}
