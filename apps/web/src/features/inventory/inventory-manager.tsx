"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type {
  InventoryListQuery,
  InventoryVariantPage,
} from "@aaraj/contracts";
import { Card } from "@/components/ui/card";
import { InventoryTable } from "./inventory-table";

export function InventoryManager({
  page,
  query,
}: {
  page: InventoryVariantPage;
  query: InventoryListQuery;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Inventory
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Track on-hand units for each active product variant in the shared
          stock pool. Checkout reservations will be connected when the payment
          flow is defined.
        </p>

        <Card className="mt-8 gap-0 rounded-2xl border border-border bg-card/70 p-4 sm:p-6">
          <InventoryTable
            variants={page.variants}
            query={query}
            hasMore={page.hasMore}
            nextOffset={page.nextOffset}
            onRefresh={() => startTransition(() => router.refresh())}
            isRefreshing={isRefreshing}
          />
        </Card>
      </div>
    </main>
  );
}
