"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { cn } from "cn";
import { fetchManagedOrder } from "./orders-client";
import { humanize, humanizeOrderStatus } from "./orders-format";

export function OrderDetailsSheet({
  onOpenChange,
  open,
  orderId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  orderId: string | null;
}) {
  const [details, setDetails] = useState<
    | { orderId: string; requestVersion: number; status: "error" }
    | {
        orderId: string;
        requestVersion: number;
        status: "success";
        order: Order;
      }
    | null
  >(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const currentDetails =
    details?.orderId === orderId && details.requestVersion === requestVersion
      ? details
      : null;
  const order =
    currentDetails?.status === "success" ? currentDetails.order : null;
  const loading = open && orderId !== null && currentDetails === null;
  const error = currentDetails?.status === "error";

  useEffect(() => {
    if (!open || !orderId) return;

    let active = true;

    void fetchManagedOrder(orderId)
      .then((result) => {
        if (active) {
          setDetails({
            orderId,
            requestVersion,
            status: "success",
            order: result,
          });
        }
      })
      .catch(() => {
        if (active) setDetails({ orderId, requestVersion, status: "error" });
      });

    return () => {
      active = false;
    };
  }, [open, orderId, requestVersion]);

  const deliveryAddress = order
    ? [
        order.address.house,
        order.address.street,
        order.address.locality,
        order.address.doorstepDetails,
        order.address.upazilaName,
        order.address.districtName,
        order.address.divisionName,
        order.address.postalCode,
      ]
        .filter((part): part is string => Boolean(part))
        .join(", ")
    : "";

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>
            {order ? `Order ${order.reference}` : "Order details"}
          </SheetTitle>
          <SheetDescription>
            {order
              ? `Placed ${formatDateTime(order.createdAt)}`
              : "Customer, delivery, items, and payment summary."}
          </SheetDescription>
        </SheetHeader>

        <div
          aria-busy={loading}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
        >
          {loading && (
            <div
              aria-label="Loading order details"
              className="grid gap-4"
              role="status"
            >
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
            </div>
          )}

          {error && !loading && (
            <div className="grid justify-items-start gap-3" role="alert">
              <p>Order details could not be loaded.</p>
              <Button
                onClick={() => setRequestVersion((version) => version + 1)}
                variant="outline"
              >
                Try again
              </Button>
            </div>
          )}

          {order && !loading && (
            <div className="grid gap-5">
              <section aria-label="Order status" className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={orderStatusVariant(order.status)}>
                    {humanizeOrderStatus(order.status)}
                  </Badge>
                  <Badge variant="secondary">
                    {humanize(order.fulfillmentStatus)}
                  </Badge>
                  <Badge variant="outline">
                    {humanize(order.serviceability)}
                  </Badge>
                </div>
                <dl className="divide-y divide-border text-sm">
                  {order.collectionStatus !== "uncollected" && (
                    <DetailRow
                      label="COD collection"
                      value={humanize(order.collectionStatus)}
                    />
                  )}
                  {order.collectedAmountBdt !== null && (
                    <DetailRow
                      label="Collected"
                      value={formatBdtPrice({
                        amountBdt: order.collectedAmountBdt,
                      })}
                    />
                  )}
                  {order.dispatch && (
                    <DetailRow
                      className="capitalize"
                      label="Delivery operator"
                      value={order.dispatch.deliveryOperator}
                    />
                  )}
                  {order.dispatch?.handoffReference && (
                    <DetailRow
                      label="Handoff reference"
                      value={order.dispatch.handoffReference}
                    />
                  )}
                </dl>
              </section>

              <section
                aria-labelledby="order-customer-heading"
                className="grid gap-2 border-t border-border pt-4"
              >
                <h3 className="font-semibold" id="order-customer-heading">
                  Customer
                </h3>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium">{order.address.recipientName}</p>
                  <a
                    aria-label={`Call ${order.address.recipientName} at ${order.address.phone}`}
                    className="mt-1 inline-flex text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    href={`tel:${order.address.phone}`}
                  >
                    {order.address.phone}
                  </a>
                </div>
              </section>

              <section
                aria-labelledby="order-delivery-heading"
                className="grid gap-2 border-t border-border pt-4"
              >
                <h3 className="font-semibold" id="order-delivery-heading">
                  Delivery address
                </h3>
                <p className="text-sm leading-relaxed">{deliveryAddress}</p>
                {order.address.instructions && (
                  <p className="text-sm text-muted-foreground">
                    Instructions: {order.address.instructions}
                  </p>
                )}
              </section>

              <section
                aria-labelledby="order-items-heading"
                className="grid gap-2 border-t border-border pt-4"
              >
                <h3 className="font-semibold" id="order-items-heading">
                  Items ({order.lines.length})
                </h3>
                <ul className="divide-y divide-border border-y border-border">
                  {order.lines.map((line) => (
                    <li
                      className="flex justify-between gap-4 py-3 text-sm"
                      key={line.variantId}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {line.productName}
                        </span>
                        <span className="text-muted-foreground">
                          {line.color} · {line.sizeLabel} · Qty {line.quantity}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <dl className="grid gap-2 border-t border-border pt-4 text-sm">
                <DetailRow
                  label="Subtotal"
                  value={formatBdtPrice({
                    amountBdt: order.merchandiseGrossBdt,
                  })}
                />
                <DetailRow
                  label="Delivery"
                  value={formatBdtPrice({
                    amountBdt: order.delivery.grossAmountBdt,
                  })}
                />
                <DetailRow
                  className="border-t border-border pt-3 text-base font-semibold"
                  label="COD due"
                  value={formatBdtPrice({ amountBdt: order.codAmountDueBdt })}
                />
              </dl>
            </div>
          )}
        </div>

        {order && (
          <SheetFooter className="border-t border-border">
            <Link
              className={buttonVariants({ size: "lg" })}
              href={`/admin/orders/${order.id}`}
              onClick={() => onOpenChange(false)}
            >
              {order.status === "awaiting_confirmation"
                ? "Review and confirm order"
                : "Open full order review"}
            </Link>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("flex justify-between gap-3 py-2", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function orderStatusVariant(
  status: Order["status"],
): "default" | "secondary" | "destructive" {
  if (status === "cancelled" || status === "rejected") return "destructive";
  if (status === "confirmed") return "default";
  return "secondary";
}
