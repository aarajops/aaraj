"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderListQuery, OrderManagementList } from "@aaraj/contracts";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date-time";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatBdtPrice } from "@/lib/currency";
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
          header: "Order ID",
          cell: ({ getValue }) => (
            <span className="font-medium">{getValue()}</span>
          ),
        }),
        columnHelper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => (
            <span className="whitespace-normal">
              {`${humanize(row.original.status)} · ${humanize(row.original.fulfillmentStatus)} · COD ${humanize(row.original.collectionStatus)}`}
            </span>
          ),
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
              : formatBdtPrice({ amountBdt: row.original.totalBdt }),
        }),
        columnHelper.accessor("createdAt", {
          header: "Created",
          cell: ({ getValue }) => formatDateTime(getValue()),
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
      <div className="container mx-auto">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Verify delivery serviceability before dispatch. Address details are
          restricted to authorized order views. Held stock stays reserved until
          dispatch or staff cancellation; use the fulfillment filter to review
          Orders awaiting dispatch.
        </p>
        <PathaoIssuesPanel />
        <AdminDataTable
          className="mt-8"
          ariaLabel="Orders"
          columns={columns}
          data={initialPage.rows}
          pathname="/admin/orders"
          query={query}
          filters={[
            {
              name: "fulfillmentStatus",
              label: "Fulfillment",
              value: query.fulfillmentStatus ?? "",
              allLabel: "All fulfillment states",
              options: [
                {
                  label: "Awaiting serviceability review",
                  value: "not_started",
                },
                {
                  label: "Awaiting dispatch (stock held)",
                  value: "awaiting_dispatch",
                },
                { label: "Dispatched", value: "dispatched" },
                { label: "Partially delivered", value: "partially_delivered" },
                { label: "Delivered", value: "delivered" },
                { label: "Delivery failed", value: "delivery_failed" },
                { label: "Returned", value: "returned" },
                { label: "Cancelled", value: "cancelled" },
              ],
            },
          ]}
          itemName="orders"
          searchPlaceholder="Order ID"
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
