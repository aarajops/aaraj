import type { ReactNode } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

function LoadingRegion({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function CheckoutLocationSkeleton() {
  return (
    <section className="min-w-0">
      <h2 className="text-xl font-semibold">Delivery location</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((field) => (
          <div className="grid gap-2" key={field}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg border border-input bg-muted/50" />
          </div>
        ))}
      </div>
    </section>
  );
}

function DeliveryDetailsSkeleton() {
  return (
    <section className="grid content-start gap-5">
      <div>
        <h2 className="text-xl font-semibold">Delivery details</h2>
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-full rounded-lg border border-input bg-muted/50" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-8 w-full rounded-lg border border-input bg-muted/50" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-16 w-full rounded-lg border border-input bg-muted/50" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-4 w-3/4 max-w-md" />
      </div>
    </section>
  );
}

function CheckoutSummarySkeleton() {
  return (
    <aside className="border-t border-border pt-6 lg:sticky lg:top-6 lg:self-start lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <h2 className="text-xl font-semibold">Order summary</h2>
      <ul className="mt-4 divide-y divide-border">
        {[0, 1].map((line) => (
          <li
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
            key={line}
          >
            <Skeleton className="size-8 rounded-lg" />
            <div className="col-start-2 row-span-2 flex min-w-0 items-center gap-3 sm:row-span-1">
              <Skeleton className="size-16 shrink-0 rounded-md" />
              <div className="grid min-w-0 flex-1 gap-2">
                <Skeleton className="h-4 w-full max-w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <Skeleton className="col-start-3 row-start-2 h-8 w-20 justify-self-end rounded-lg sm:row-start-1" />
            <Skeleton className="col-start-3 row-start-1 h-4 w-14 justify-self-end sm:col-start-4" />
          </li>
        ))}
      </ul>
      <dl className="grid gap-3 border-t border-border pt-4">
        {[0, 1].map((row) => (
          <div className="flex justify-between gap-4" key={row}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border pt-4">
          <Skeleton className="h-5 w-36 max-w-full" />
          <Skeleton className="h-5 w-20" />
        </div>
      </dl>
      <Skeleton className="mt-5 h-11 w-full rounded-lg" />
    </aside>
  );
}

export function CheckoutPageSkeleton() {
  return (
    <main className="bg-background px-5 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
          <Link className="text-sm text-primary hover:underline" href="/shop">
            Continue shopping
          </Link>
        </div>
        <LoadingRegion label="checkout">
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:gap-12">
            <div className="grid content-start gap-8">
              <CheckoutLocationSkeleton />
              <DeliveryDetailsSkeleton />
            </div>
            <CheckoutSummarySkeleton />
          </div>
        </LoadingRegion>
      </div>
    </main>
  );
}

export function CustomerOrderDetailsSkeleton() {
  return (
    <LoadingRegion label="order details">
      <header className="border-b border-border pb-6">
        <Skeleton className="h-4 w-14" />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Skeleton className="h-9 w-48 max-w-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-4/5 max-w-lg" />
        </div>
        <Skeleton className="mt-4 h-4 w-40" />
      </header>

      <section className="py-6">
        <Skeleton className="h-4 w-12" />
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {[0, 1].map((line) => (
            <li
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-3"
              key={line}
            >
              <div className="grid gap-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-16" />
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border py-6">
        <Skeleton className="h-4 w-16" />
        <div className="mt-3 grid gap-2">
          {[0, 1].map((row) => (
            <div className="flex justify-between gap-4" key={row}>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between gap-4 border-t border-border pt-3">
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </section>

      <section className="border-t border-border py-6">
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
        </div>
      </section>

      <footer className="border-t border-border py-6">
        <Skeleton className="h-4 w-32" />
      </footer>
    </LoadingRegion>
  );
}
