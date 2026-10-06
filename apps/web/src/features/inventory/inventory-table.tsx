"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { InventoryListQuery, InventoryVariant } from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";

const columnHelper = createDataTableColumnHelper<InventoryVariant>();

export function InventoryTable({
  variants,
  query,
  hasMore,
  nextOffset,
  onRefresh,
  isRefreshing = false,
}: {
  variants: InventoryVariant[];
  query: InventoryListQuery;
  hasMore: boolean;
  nextOffset: number | null;
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("productName", {
          header: "Product and variant",
          cell: ({ row }) => (
            <div className="min-w-44">
              <p className="font-medium text-foreground">
                {row.original.productName}
              </p>
              <p className="text-sm text-muted-foreground">
                {row.original.color} · {row.original.sizeLabel}
              </p>
            </div>
          ),
        }),
        columnHelper.accessor("sku", {
          header: "SKU",
          cell: ({ getValue }) => (
            <span className="font-mono text-sm">{getValue()}</span>
          ),
        }),
        columnHelper.display({
          id: "quantityOnHand",
          header: "On hand",
          cell: ({ row }) => (
            <Badge
              variant={
                row.original.quantityOnHand > 0 ? "outline" : "secondary"
              }
              className={
                row.original.quantityOnHand > 0
                  ? "border-success/30 bg-success/10 text-success"
                  : ""
              }
            >
              {row.original.quantityOnHand}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: "stockUpdatedAt",
          header: "Last adjustment",
          cell: ({ row }) =>
            row.original.stockUpdatedAt
              ? row.original.stockUpdatedAt.slice(0, 10)
              : "No stock recorded",
        }),
        columnHelper.display({
          id: "actions",
          header: "Actions",
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/admin/inventory/${encodeURIComponent(row.original.id)}`}
              aria-label={`Adjust stock for ${row.original.productName}, ${row.original.color}, ${row.original.sizeLabel}`}
              prefetch={false}
            >
              Adjust stock
            </Link>
          ),
        }),
      ]),
    [],
  );

  return (
    <AdminDataTable
      ariaLabel="Inventory by product variant"
      columns={columns}
      data={variants}
      emptyMessage={
        query.search
          ? "No active variants match this search."
          : "Create an active product variant before recording stock."
      }
      pathname="/admin/inventory"
      query={query}
      itemName="inventory variants"
      searchPlaceholder="Product, SKU, color, or size"
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      hasMore={hasMore}
      nextOffset={nextOffset}
    />
  );
}
