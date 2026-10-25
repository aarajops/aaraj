"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderListQuery, OrderManagementList } from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/date-time";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatBdtPrice } from "@/lib/currency";
import type { ManagedOrderRow, ManagedOrdersPage } from "./orders-view-model";

const columnHelper = createDataTableColumnHelper<ManagedOrderRow>();

export function OrdersManager({
  initialPage,
  query,
}: {
  initialPage: ManagedOrdersPage;
  query: OrderListQuery;
}) {
  const router = useRouter();

  const columns = useMemo(() => {
    return columnHelper.columns([
      columnHelper.display({
        id: "order",
        header: "Order",
        cell: ({ row }) => (
          <div className="grid gap-1">
            <Link
              className="rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
              href={`/admin/orders/${row.original.id}`}
              prefetch={false}
            >
              {row.original.reference}
            </Link>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(row.original.createdAt)}
            </span>
          </div>
        ),
      }),
      columnHelper.display({
        id: "status",
        header: "Order status",
        cell: ({ row }) => (
          <div className="grid gap-1">
            <Badge variant={orderStatusVariant(row.original.status)}>
              {humanize(row.original.status)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {humanize(row.original.fulfillmentStatus)}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("serviceability", {
        header: "Serviceability",
        cell: ({ getValue }) => {
          const serviceability = getValue();
          return (
            <Badge variant={serviceabilityVariant(serviceability)}>
              {humanize(serviceability)}
            </Badge>
          );
        },
      }),
      columnHelper.display({
        id: "delivery",
        header: "Delivery",
        cell: ({ row }) => (
          <CourierStatus
            deliveryProvider={row.original.deliveryProvider}
            summary={row.original.pathaoSummary}
            available={initialPage.pathaoSummaryAvailable}
          />
        ),
      }),
      columnHelper.display({
        id: "codDue",
        header: "COD due",
        meta: {
          align: "right",
          numeric: true,
        },
        cell: ({ row }) => (
          <div className="grid gap-1">
            {row.original.status === "cancelled" ||
            row.original.status === "rejected" ? (
              <span className="text-muted-foreground">Not payable</span>
            ) : (
              formatBdtPrice({ amountBdt: row.original.codAmountDueBdt })
            )}
            <span className="text-xs text-muted-foreground">
              {humanize(row.original.collectionStatus)}
            </span>
          </div>
        ),
      }),
    ]);
  }, [initialPage.pathaoSummaryAvailable]);

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="container mx-auto">
        <p className="text-sm font-semibold tracking-widest text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-muted-foreground">
          Review order status, delivery checks, and dispatch.
        </p>
        <AdminDataTable
          className="mt-5"
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
          searchPlaceholder="Search order ID"
          onRefresh={() => router.refresh()}
          page={initialPage}
        />
      </div>
    </main>
  );
}

function CourierStatus({
  deliveryProvider,
  summary,
  available,
}: {
  deliveryProvider: "manual" | "pathao" | null;
  summary: ManagedOrderRow["pathaoSummary"];
  available: boolean;
}) {
  if (deliveryProvider === "pathao" && !available) {
    return <span className="text-sm text-muted-foreground">Unavailable</span>;
  }
  if (
    summary?.hasUnresolvedWebhookIssue ||
    summary?.status === "outcome_unknown" ||
    summary?.status === "reconciliation_required" ||
    summary?.trackingProgress === "reconciliation_required"
  ) {
    return <Badge variant="destructive">Needs review</Badge>;
  }
  if (summary?.status === "submitting") {
    return <Badge variant="outline">Booking</Badge>;
  }
  if (summary?.status === "booked") {
    return (
      <div className="grid gap-1">
        <Badge variant="secondary">
          {humanize(summary.trackingProgress ?? "booked")}
        </Badge>
        {summary.consignmentId && (
          <span className="text-xs text-muted-foreground">
            {summary.consignmentId}
          </span>
        )}
      </div>
    );
  }
  if (deliveryProvider === "pathao") {
    return <Badge variant="secondary">Not booked</Badge>;
  }
  if (deliveryProvider === "manual") {
    return <Badge variant="outline">Manual delivery</Badge>;
  }
  return <span className="text-sm text-muted-foreground">Not assigned</span>;
}

function orderStatusVariant(
  status: OrderManagementList["rows"][number]["status"],
): "default" | "secondary" | "destructive" {
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "confirmed") return "default";
  return "secondary";
}

function serviceabilityVariant(
  status: OrderManagementList["rows"][number]["serviceability"],
): "secondary" | "outline" | "destructive" {
  if (status === "unserviceable") return "destructive";
  if (status === "pending_manual_review") return "outline";
  return "secondary";
}

export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
