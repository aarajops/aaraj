"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type {
  InventoryListQuery,
  InventoryVariantPage,
} from "@aaraj/contracts";
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
      <div className="container mx-auto">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Inventory
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Track stock for active product variants.
        </p>

        <InventoryTable
          className="mt-8"
          variants={page.variants}
          query={query}
          page={page}
          onRefresh={() => startTransition(() => router.refresh())}
          isRefreshing={isRefreshing}
        />
      </div>
    </main>
  );
}
