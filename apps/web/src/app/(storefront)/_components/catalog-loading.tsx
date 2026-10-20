import { SlidersHorizontal } from "lucide-react";
import {
  CatalogAudienceSchema,
  DEFAULT_PUBLIC_CATALOG_PAGE_SIZE,
} from "@aaraj/contracts";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductCardSkeleton } from "./product-card";

const audienceOptions = ["All audiences", ...CatalogAudienceSchema.options];

export function CatalogLoading() {
  return (
    <div aria-busy="true">
      <p aria-live="polite" className="sr-only" role="status">
        Loading products
      </p>
      <div aria-hidden="true">
        <header className="mb-3">
          <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
        </header>
        <div className="grid gap-6 lg:grid-cols-4 xl:gap-8">
          <aside className="hidden min-w-0 lg:col-span-1 lg:block">
            <h2 className="mb-3 mt-5 flex items-center gap-2 text-base font-semibold text-foreground">
              <SlidersHorizontal
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              Filters
            </h2>
            <div className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-5">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Price range
                </h3>
                <div className="flex h-6 items-center">
                  <div className="relative h-1.5 w-full rounded-full bg-muted">
                    <div className="absolute inset-0 rounded-full bg-primary" />
                    <span className="absolute left-0 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-background" />
                    <span className="absolute right-0 top-1/2 size-4 translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-background" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <span className="text-sm font-medium text-foreground">
                      Minimum (৳)
                    </span>
                    <Skeleton className="h-8 w-full rounded-lg border border-input bg-muted/50" />
                  </div>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium text-foreground">
                      Maximum (৳)
                    </span>
                    <Skeleton className="h-8 w-full rounded-lg border border-input bg-muted/50" />
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {["Size", "Color"].map((group) => (
                  <div className="space-y-3" key={group}>
                    <h3 className="text-sm font-semibold text-foreground">
                      {group}
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-2.5">
                        <Skeleton className="size-4 rounded-sm" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Audience
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {audienceOptions.map((option) => (
                      <div
                        className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-2.5"
                        key={option}
                      >
                        <Skeleton className="size-4 rounded-full" />
                        <span className="text-sm">
                          {option.replace(/^\w/, (letter) =>
                            letter.toUpperCase(),
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>
          <section
            aria-label="Product results"
            className="min-w-0 lg:col-span-3"
          >
            <div className="flex flex-wrap items-end justify-end gap-4">
              <div className="hidden items-center gap-1 lg:flex">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton className="size-9 rounded-lg" key={index} />
                ))}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="flex justify-end lg:hidden">
                    <Skeleton className="h-8 w-24 rounded-lg border border-input bg-muted/50" />
                  </div>
                  <div className="ml-auto grid gap-2">
                    <span className="text-sm font-medium text-foreground">
                      Sort by
                    </span>
                    <Skeleton className="h-10 w-36 rounded-lg sm:w-44" />
                  </div>
                </div>
              </div>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:gap-x-5 2xl:grid-cols-4">
              {Array.from(
                { length: DEFAULT_PUBLIC_CATALOG_PAGE_SIZE },
                (_, index) => (
                  <li key={index}>
                    <ProductCardSkeleton />
                  </li>
                ),
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
