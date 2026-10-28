"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type {
  InventoryListQuery,
  InventoryVariantPage,
} from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
    <>
      <div>
        <AdminPageHeader
          title="Inventory"
          description="Track stock by product variant."
        />

        <InventoryTable
          className="mt-6"
          variants={page.variants}
          query={query}
          page={page}
          onRefresh={() => startTransition(() => router.refresh())}
          isRefreshing={isRefreshing}
        />
      </div>
    </>
  );
}
