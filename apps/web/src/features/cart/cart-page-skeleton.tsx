import type { ReactNode } from "react";
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

function CartLinesSkeleton() {
  return (
    <section className="rounded-2xl border border-border p-5 sm:p-7">
      <ul className="divide-y divide-border">
        {[0, 1].map((line) => (
          <li
            className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            key={line}
          >
            <div className="grid gap-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-20 rounded-lg" />
              <Skeleton className="h-10 w-20 rounded-lg" />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-border pt-4">
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    </section>
  );
}

function CartDeliverySkeleton() {
  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-7">
      <Skeleton className="h-6 w-56 max-w-full" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((field) => (
          <div className="grid gap-2" key={field}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg border border-input bg-muted/50" />
          </div>
        ))}
        <Skeleton className="h-10 w-36 rounded-lg sm:col-span-2" />
      </div>
    </section>
  );
}

export function CartPageContentSkeleton() {
  return (
    <LoadingRegion label="cart">
      <div className="mt-8">
        <CartLinesSkeleton />
        <CartDeliverySkeleton />
      </div>
    </LoadingRegion>
  );
}

export function CartPageLoadingSkeleton() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-primary">
          AARAJ
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Your cart</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Prices shown here are saved snapshots and may change before purchase.
        </p>
        <CartPageContentSkeleton />
      </div>
    </main>
  );
}

export function DeliveryLocationLoadingSkeleton({
  mode,
}: {
  mode: "cart" | "checkout";
}) {
  return (
    <LoadingRegion label="delivery locations">
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((field) => (
          <div className="grid gap-2" key={field}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-lg border border-input bg-muted/50" />
          </div>
        ))}
        {mode === "cart" && (
          <Skeleton className="h-10 w-36 rounded-lg sm:col-span-2" />
        )}
      </div>
    </LoadingRegion>
  );
}
