"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, Printer } from "lucide-react";
import type { OrderListQuery } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLinkItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/date-time";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatBdtPrice } from "@/lib/currency";
import type { ManagedOrderRow, ManagedOrdersPage } from "./orders-view-model";
import { OrderDetailsSheet } from "./order-details-sheet";
import { humanize, humanizePathaoStatus } from "./orders-format";
import { OrderStatusBadge, ShipmentStatusBadge } from "./order-status-badges";

const columnHelper = createDataTableColumnHelper<ManagedOrderRow>();

export function OrdersManager({
  initialPage,
  query,
}: {
  initialPage: ManagedOrdersPage;
  query: OrderListQuery;
}) {
  const router = useRouter();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const columns = useMemo(() => {
    return columnHelper.columns([
      columnHelper.display({
        id: "order",
        header: "Order",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              aria-haspopup="dialog"
              className="h-auto justify-start rounded-sm px-0 py-0 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
              onClick={() => setSelectedOrderId(row.original.id)}
              type="button"
              variant="link"
            >
              {row.original.reference}
            </Button>
            <Button
              aria-label={`Copy order ID ${row.original.reference}`}
              className="text-muted-foreground"
              onClick={() =>
                void copyOrderValue(row.original.reference, "Order ID")
              }
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
        ),
      }),
      columnHelper.accessor("createdAt", {
        header: "Placed",
        cell: ({ getValue }) => formatDateTime(getValue()),
      }),
      columnHelper.display({
        id: "customer",
        header: "Customer",
        cell: ({ row }) => (
          <div className="grid gap-1">
            <span className="font-medium">{row.original.customerName}</span>
            <div className="flex items-center gap-1">
              <a
                className="w-fit rounded-sm text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
                href={`tel:${row.original.customerPhone}`}
                aria-label={`Call ${row.original.customerName} at ${row.original.customerPhone}`}
              >
                {row.original.customerPhone}
              </a>
              <Button
                aria-label={`Copy phone number for ${row.original.customerName}`}
                className="text-muted-foreground"
                onClick={() =>
                  void copyOrderValue(
                    row.original.customerPhone.replace(/^\+880/, "0"),
                    "Phone number",
                  )
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Copy aria-hidden="true" />
              </Button>
            </div>
          </div>
        ),
      }),
      columnHelper.display({
        id: "items",
        header: "Items",
        meta: { className: "min-w-52 max-w-64 whitespace-normal" },
        cell: ({ row }) => {
          const [item, ...remainingItems] = row.original.items;

          return (
            <div className="grid gap-1 whitespace-normal">
              {item ? (
                <span>{item.productName}</span>
              ) : (
                <span className="text-muted-foreground">No items</span>
              )}
              {item && (item.color || item.sizeLabel) && (
                <span className="text-xs text-muted-foreground">
                  {[item.color, item.sizeLabel].filter(Boolean).join(" · ")}
                </span>
              )}
              {remainingItems.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  +{remainingItems.length} more item
                  {remainingItems.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "pieces",
        header: "Pieces",
        meta: { align: "right", numeric: true },
        cell: ({ row }) =>
          row.original.items.reduce((total, line) => total + line.quantity, 0),
      }),
      columnHelper.display({
        id: "zone",
        header: "Zone",
        cell: ({ row }) =>
          row.original.deliveryZone ? (
            humanize(row.original.deliveryZone)
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      columnHelper.display({
        id: "status",
        header: "Order status",
        cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
      }),
      columnHelper.display({
        id: "delivery",
        header: "Shipment",
        cell: ({ row }) => (
          <CourierStatus
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
        cell: ({ row }) =>
          formatBdtPrice({ amountBdt: row.original.codAmountDueBdt }),
      }),
    ]);
  }, [initialPage.pathaoSummaryAvailable]);

  return (
    <>
      <div>
        <AdminPageHeader
          title="Orders"
          description="Review orders and manage courier handoffs."
        />
        <AdminDataTable
          className="mt-6"
          ariaLabel="Orders"
          columns={columns}
          data={initialPage.rows}
          rowActions={(order) => (
            <>
              <DropdownMenuItem
                aria-haspopup="dialog"
                onClick={() => setSelectedOrderId(order.id)}
              >
                <Eye aria-hidden="true" className="size-4" />
                View order
              </DropdownMenuItem>
              <DropdownMenuLinkItem
                closeOnClick
                href={`/admin/orders/${order.id}/invoice?print=1`}
                rel="noreferrer"
                target="_blank"
              >
                <Printer aria-hidden="true" className="size-4" />
                Print invoice
              </DropdownMenuLinkItem>
            </>
          )}
          pathname="/admin/orders"
          query={query}
          filters={[
            {
              name: "status",
              label: "Order",
              value: query.status ?? "",
              allLabel: "All order statuses",
              options: [
                {
                  label: "Pending",
                  value: "pending",
                },
                { label: "No answer", value: "no_answer" },
                { label: "Confirmed", value: "confirmed" },
                { label: "On hold", value: "on_hold" },
                { label: "Cancelled", value: "cancelled" },
              ],
            },
            {
              name: "fulfillmentStatus",
              label: "Fulfillment",
              value: query.fulfillmentStatus ?? "",
              allLabel: "All fulfillment states",
              options: [
                { label: "Not started", value: "not_started" },
                {
                  label: "Awaiting pickup (stock held)",
                  value: "awaiting_dispatch",
                },
                { label: "Picked up", value: "dispatched" },
                { label: "Partially delivered", value: "partially_delivered" },
                { label: "Delivered", value: "delivered" },
                { label: "Delivery failed", value: "delivery_failed" },
                { label: "Returned", value: "returned" },
                { label: "Cancelled", value: "cancelled" },
              ],
            },
          ]}
          itemName="orders"
          searchPlaceholder="Search order ID, name, or phone"
          onRefresh={() => router.refresh()}
          page={initialPage}
        />
      </div>
      <OrderDetailsSheet
        onFulfillmentUpdated={() => router.refresh()}
        onOpenChange={(open) => {
          if (!open) setSelectedOrderId(null);
        }}
        open={selectedOrderId !== null}
        orderId={selectedOrderId}
      />
    </>
  );
}

async function copyOrderValue(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({
      title: `${label} copied`,
      description: value,
      type: "success",
    });
  } catch {
    toast.add({
      title: `Could not copy ${label.toLowerCase()}`,
      description: "Your browser could not access the clipboard.",
      type: "error",
    });
  }
}

function CourierStatus({
  summary,
  available,
}: {
  summary: ManagedOrderRow["pathaoSummary"];
  available: boolean;
}) {
  if (!available) {
    return (
      <ShipmentStatusBadge label="Status unavailable" status="unavailable" />
    );
  }
  if (
    summary?.status === "outcome_unknown" ||
    summary?.status === "reconciliation_required" ||
    summary?.trackingProgress === "reconciliation_required"
  ) {
    return (
      <ShipmentStatusBadge
        label="Needs review"
        status="needs_review"
        variant="destructive"
      />
    );
  }
  if (summary?.status === "submitting") {
    return (
      <ShipmentStatusBadge
        label="Booking"
        status="submitting"
        variant="outline"
      />
    );
  }
  if (summary?.status === "cancelled") {
    return (
      <div className="grid gap-1">
        <ShipmentStatusBadge label="Cancelled" status="cancelled" />
        {summary.consignmentId && (
          <span className="text-xs text-muted-foreground">
            {summary.consignmentId}
          </span>
        )}
      </div>
    );
  }
  if (summary?.status === "booked") {
    const trackingProgress = summary.trackingProgress ?? "booked";
    return (
      <div className="grid gap-1">
        <ShipmentStatusBadge
          label={humanizePathaoStatus(trackingProgress)}
          status={trackingProgress}
        />
        {summary.consignmentId && (
          <span className="text-xs text-muted-foreground">
            {summary.consignmentId}
          </span>
        )}
      </div>
    );
  }
  return <ShipmentStatusBadge label="Not booked" status="not_booked" />;
}
