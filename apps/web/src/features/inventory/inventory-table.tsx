"use client";

import { useMemo } from "react";
import type {
  InventoryListQuery,
  InventoryVariant,
  InventoryVariantPage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatDateTime } from "@/lib/date-time";
import { Boxes } from "lucide-react";

const columnHelper = createDataTableColumnHelper<InventoryVariant>();

export function InventoryTable({
  variants,
  query,
  page,
  onRefresh,
  isRefreshing = false,
  className,
}: {
  variants: InventoryVariant[];
  query: InventoryListQuery;
  page: Pick<
    InventoryVariantPage,
    "limit" | "offset" | "hasMore" | "nextOffset"
  >;
  onRefresh: () => void;
  isRefreshing?: boolean;
  className?: string;
}) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("productName", {
          header: "Product and variant",
          cell: ({ row }) => (
            <div className="whitespace-normal">
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
          meta: {
            align: "right",
            numeric: true,
          },
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
        columnHelper.accessor("quantityReserved", {
          header: "Reserved",
          meta: {
            align: "right",
            numeric: true,
          },
          cell: ({ getValue }) => getValue(),
        }),
        columnHelper.accessor("quantityAvailable", {
          header: "Available",
          meta: {
            align: "right",
            numeric: true,
          },
          cell: ({ getValue }) => getValue(),
        }),
        columnHelper.display({
          id: "stockUpdatedAt",
          header: "Last stock change",
          cell: ({ row }) =>
            row.original.stockUpdatedAt
              ? formatDateTime(row.original.stockUpdatedAt)
              : "No stock recorded",
        }),
      ]),
    [],
  );

  return (
    <AdminDataTable
      className={className}
      ariaLabel="Inventory by product variant"
      columns={columns}
      data={variants}
      rowActions={(variant) => (
        <DropdownMenuLinkItem
          closeOnClick
          href={`/admin/inventory/${encodeURIComponent(variant.id)}`}
        >
          <Boxes aria-hidden="true" className="size-4" />
          Adjust stock
        </DropdownMenuLinkItem>
      )}
      pathname="/admin/inventory"
      query={query}
      itemName="active variants"
      searchPlaceholder="Product, SKU, color, or size"
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      page={page}
    />
  );
}
