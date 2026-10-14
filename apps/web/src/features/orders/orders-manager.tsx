"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderListQuery, OrderManagementList } from "@aaraj/contracts";
import { buttonVariants } from "@/components/ui/button";
import { formatAdminDateTime } from "@/features/admin/admin-date-time";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";
import { formatCatalogPrice } from "@/features/catalog/price";
import { PathaoIssuesPanel } from "./pathao-issues-panel";

const columnHelper =
  createDataTableColumnHelper<OrderManagementList["rows"][number]>();

export function OrdersManager({
  initialPage,
  query,
}: {
  initialPage: OrderManagementList;
  query: OrderListQuery;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("reference", {
          header: "Reference",
          cell: ({ getValue }) => (
            <span className="font-medium">{getValue()}</span>
          ),
        }),
        columnHelper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) =>
            `${humanize(row.original.status)} · ${humanize(row.original.fulfillmentStatus)}`,
        }),
        columnHelper.accessor("serviceability", {
          header: "Delivery review",
          cell: ({ getValue }) => humanize(getValue()),
        }),
        columnHelper.display({
          id: "codDue",
          header: "COD due",
          meta: {
            align: "right",
            numeric: true,
          },
          cell: ({ row }) =>
            row.original.status === "cancelled" ||
            row.original.status === "rejected"
              ? "Not payable"
              : formatCatalogPrice({ amountBdt: row.original.totalBdt }),
        }),
        columnHelper.accessor("createdAt", {
          header: "Created",
          cell: ({ getValue }) => formatAdminDateTime(getValue()),
        }),
        columnHelper.display({
          id: "review",
          header: "Actions",
          meta: { align: "right" },
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ size: "lg", variant: "link" })}
              href={`/admin/orders/${row.original.id}`}
              prefetch={false}
            >
              Review
            </Link>
          ),
        }),
      ]),
    [],
  );

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Review COD Orders and verify delivery serviceability before dispatch
          confirmation. Address details appear only on an authorized Order
          detail page.
        </p>
        <PathaoIssuesPanel />
        <AdminDataTable
          className="mt-8"
          ariaLabel="Orders"
          columns={columns}
          data={initialPage.rows}
          emptyMessage={
            query.search
              ? "No orders match this reference search."
              : "No orders yet."
          }
          pathname="/admin/orders"
          query={query}
          itemName="orders"
          searchPlaceholder="Order reference"
          onRefresh={() => startTransition(() => router.refresh())}
          isRefreshing={refreshing}
          hasMore={initialPage.hasMore}
          nextOffset={initialPage.nextOffset}
        />
      </div>
    </main>
  );
}

export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
