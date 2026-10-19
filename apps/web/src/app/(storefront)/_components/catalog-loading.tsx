import { Skeleton } from "@/components/ui/skeleton";

export function CatalogLoading() {
  return (
    <div aria-busy="true" className="space-y-3">
      <p aria-live="polite" className="sr-only" role="status">
        Loading products
      </p>
      <div aria-hidden="true">
        <div className="mb-3">
          <Skeleton className="h-14 w-72 max-w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-4 xl:gap-8">
          <aside className="hidden min-w-0 lg:col-span-1 lg:block">
            <Skeleton className="mb-2 mt-5 h-5 w-16" />
            <div className="space-y-6 rounded-xl border border-border bg-card/50 p-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </aside>
          <section className="min-w-0 lg:col-span-3">
            <div className="flex justify-end">
              <Skeleton className="h-[60px] w-44" />
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="space-y-3" key={index}>
                  <Skeleton className="aspect-[3/4] w-full rounded-xl" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-1/3" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
