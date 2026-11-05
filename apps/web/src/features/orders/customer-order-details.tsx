"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { fetchOrder, OrderRequestError } from "./orders-client";
import { getPathaoCustomerTracking } from "./pathao-client";
import type { PathaoCustomerTracking } from "@aaraj/contracts";
import { CustomerOrderDetailsSkeleton } from "./order-page-skeleton";
import { humanizePathaoStatus } from "./orders-format";
import { sendCheckoutPurchase } from "@/features/analytics/gtm-ecommerce";

export function CustomerOrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<PathaoCustomerTracking | null>(null);
  const [trackingUnavailable, setTrackingUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchOrder(orderId)
      .then((result) => {
        if (active) {
          sendCheckoutPurchase(result);
          setOrder(result);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof OrderRequestError && reason.status === 404
              ? "We couldn’t access this order. Its secure guest link may have expired. Contact AARAJ support with your order number. Order details are shared only after identity verification."
              : reason instanceof Error
                ? reason.message
                : "Order details could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  useEffect(() => {
    if (order?.courierHandoff?.deliveryProvider !== "pathao") return;

    let active = true;
    void getPathaoCustomerTracking(orderId)
      .then((result) => {
        if (active) setTracking(result);
      })
      .catch(() => {
        if (active) setTrackingUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [
    orderId,
    order?.courierHandoff?.deliveryProvider,
    order?.courierHandoff?.pickedUpAt,
  ]);

  const presentation = order ? getOrderPresentation(order) : null;
  const settlement = order ? getSettlementSummary(order) : null;

  return (
    <main className="flex-1 bg-background px-5 py-10 text-foreground sm:py-14">
      <article className="mx-auto max-w-2xl">
        {error ? (
          <section>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              AARAJ
            </p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight">
              Order unavailable
            </h1>
            <p
              className="mt-4 text-sm leading-6 text-muted-foreground"
              role="alert"
            >
              {error}
            </p>
            <Link
              className="mt-6 inline-flex text-sm font-medium text-primary underline underline-offset-4"
              href="/shop"
            >
              Continue shopping
            </Link>
          </section>
        ) : !order ? (
          <CustomerOrderDetailsSkeleton />
        ) : (
          <>
            <header className="border-b border-border pb-6">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                AARAJ
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-3xl font-medium tracking-tight">
                  {presentation?.title}
                </h1>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${presentation?.statusClass}`}
                >
                  {presentation?.statusLabel}
                </span>
              </div>
              <p
                className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground"
                role="status"
              >
                {presentation?.message}
              </p>
              <p className="mt-4 text-sm">
                <span className="text-muted-foreground">Order </span>
                <span className="font-medium" data-testid="order-reference">
                  {order.reference}
                </span>
              </p>
            </header>

            <section aria-labelledby="order-items-heading" className="py-6">
              <h2 className="text-sm font-semibold" id="order-items-heading">
                Items
              </h2>
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {order.lines.map((line) => (
                  <li
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-3 text-sm"
                    key={line.variantId}
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{line.productName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {line.color} · {line.sizeLabel} · Qty {line.quantity}
                      </p>
                    </div>
                    <span className="grid justify-items-end whitespace-nowrap">
                      {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                      {line.compareAtPriceBdt !== null &&
                        line.compareAtPriceBdt > line.unitPriceBdt && (
                          <del className="text-xs text-muted-foreground">
                            {formatBdtPrice({
                              amountBdt: line.compareAtPriceBdt * line.quantity,
                            })}
                          </del>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="payment-heading"
              className="border-t border-border py-6"
            >
              <h2 className="text-sm font-semibold" id="payment-heading">
                Payment
              </h2>
              <dl className="mt-3 grid gap-2 text-sm">
                <DataRow label="Payment method" value="Cash on Delivery" />
                <DataRow
                  label="Delivery fee"
                  value={formatBdtPrice({
                    amountBdt: order.delivery.grossAmountBdt,
                  })}
                />
              </dl>
              <div className="mt-3 flex items-start justify-between gap-4 border-t border-border pt-3">
                <div>
                  <p className="text-sm font-semibold">{settlement?.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {settlement?.detail}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold">
                  {settlement?.amount}
                </p>
              </div>
            </section>

            <section
              aria-labelledby="delivery-address-heading"
              className="border-t border-border py-6"
            >
              <h2
                className="text-sm font-semibold"
                id="delivery-address-heading"
              >
                Delivery address
              </h2>
              <address className="mt-3 space-y-1 text-sm not-italic leading-6 text-secondary-foreground">
                <span className="block">
                  {order.address.recipientName} · {order.address.phone}
                </span>
                <span className="block">
                  {[
                    order.address.house,
                    order.address.street,
                    order.address.doorstepDetails,
                    order.address.upazilaName,
                    order.address.districtName,
                    order.address.divisionName,
                    order.address.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {order.address.instructions && (
                  <span className="block text-muted-foreground">
                    {order.address.instructions}
                  </span>
                )}
              </address>
            </section>

            {tracking?.booking && (
              <section
                aria-label="Courier tracking"
                className="border-t border-border py-6"
              >
                <h2 className="text-sm font-semibold">Tracking</h2>
                <dl className="mt-3 grid gap-2 text-sm">
                  <DataRow
                    label="Consignment"
                    value={tracking.booking.consignmentId}
                  />
                  <DataRow
                    label="Latest progress"
                    value={humanizePathaoStatus(
                      tracking.booking.trackingProgress,
                    )}
                  />
                </dl>
                {tracking.observations.length > 0 && (
                  <ol className="mt-3 divide-y divide-border text-sm">
                    {tracking.observations.map((observation) => (
                      <li
                        className="py-2 text-muted-foreground"
                        key={`${observation.event}-${observation.receivedAt}`}
                      >
                        {humanizePathaoStatus(observation.event)} ·{" "}
                        {formatDateTime(
                          observation.providerTimestamp ??
                            observation.receivedAt,
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {trackingUnavailable &&
              order.courierHandoff?.deliveryProvider === "pathao" && (
                <p
                  className="border-t border-border py-4 text-xs text-muted-foreground"
                  role="status"
                >
                  Tracking updates are temporarily unavailable. Please check
                  again soon.
                </p>
              )}

            {order.guestAccessExpiresAt && (
              <p className="border-t border-border py-4 text-xs text-muted-foreground">
                Guest tracking is available in this browser until{" "}
                {formatDateTime(order.guestAccessExpiresAt)}.
              </p>
            )}

            <footer className="border-t border-border py-6">
              <Link
                className="inline-flex text-sm font-medium text-primary underline underline-offset-4"
                href="/shop"
              >
                Continue shopping
              </Link>
            </footer>
          </>
        )}
      </article>
    </main>
  );
}

function getOrderPresentation(order: Order) {
  if (order.status === "cancelled") {
    const cancelledDate = order.cancelledAt
      ? ` on ${formatDateTime(order.cancelledAt)}`
      : "";
    return {
      title: "Order cancelled",
      statusLabel: "Cancelled",
      statusClass: "bg-muted text-muted-foreground",
      message: `This order was cancelled before courier pickup${cancelledDate}. No payment is due.`,
    };
  }

  if (order.status === "no_answer") {
    return {
      title: "Order pending",
      statusLabel: "No answer",
      statusClass:
        "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
      message: "We could not reach you by phone. Your order remains pending.",
    };
  }

  if (order.status === "on_hold") {
    return {
      title: "Order on hold",
      statusLabel: "On hold",
      statusClass:
        "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
      message:
        "Your order is paused as requested. We’ll contact you before preparing it for courier pickup.",
    };
  }

  if (order.fulfillmentStatus === "delivered") {
    return {
      title: "Delivered",
      statusLabel: "Complete",
      statusClass: "bg-muted text-foreground",
      message: "Your order is recorded as delivered.",
    };
  }

  if (order.fulfillmentStatus === "partially_delivered") {
    return {
      title: "Partially delivered",
      statusLabel: "In progress",
      statusClass: "bg-muted text-foreground",
      message: "Part of your order has been delivered.",
    };
  }

  if (order.fulfillmentStatus === "returned") {
    return {
      title: "Order returned",
      statusLabel: "Returned",
      statusClass: "bg-muted text-muted-foreground",
      message: "The courier has returned this order to AARAJ.",
    };
  }

  if (order.fulfillmentStatus === "delivery_failed") {
    return {
      title: "Delivery issue",
      statusLabel: "Reviewing next step",
      statusClass:
        "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
      message:
        "A delivery attempt was unsuccessful. AARAJ is reviewing the next step.",
    };
  }

  if (order.courierHandoff) {
    return {
      title: "With courier",
      statusLabel: "With courier",
      statusClass: "bg-muted text-foreground",
      message: "Your order has been handed to the courier.",
    };
  }

  if (order.status === "pending") {
    return {
      title: "Order received",
      statusLabel: "Pending",
      statusClass:
        "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
      message:
        "We’ll contact you to verify your order and delivery details before courier pickup.",
    };
  }

  if (order.status === "confirmed") {
    return {
      title: "Order confirmed",
      statusLabel: "Preparing your order",
      statusClass: "bg-muted text-foreground",
      message: "We’re preparing your order for courier pickup.",
    };
  }

  return {
    title: "Order update",
    statusLabel: "In progress",
    statusClass: "bg-muted text-foreground",
    message: "Your order status is being updated.",
  };
}

function getSettlementSummary(order: Order) {
  if (order.status === "cancelled") {
    return {
      label: "Order total",
      detail: "Cash on Delivery · Nothing is payable",
      amount: formatBdtPrice({ amountBdt: order.totalBdt }),
    };
  }

  if (order.collectionStatus === "collected") {
    return {
      label: "COD collected",
      detail: "Collection recorded",
      amount: formatBdtPrice({
        amountBdt: order.collectedAmountBdt ?? order.codAmountDueBdt,
      }),
    };
  }

  if (order.collectionStatus === "discrepancy") {
    return {
      label: "Collection under review",
      detail: "AARAJ is reconciling the collected amount",
      amount: formatBdtPrice({
        amountBdt: order.collectedAmountBdt ?? order.codAmountDueBdt,
      }),
    };
  }

  return {
    label: "Total due on delivery",
    detail: "Uncollected; no payment was taken at checkout",
    amount: formatBdtPrice({ amountBdt: order.codAmountDueBdt }),
  };
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
