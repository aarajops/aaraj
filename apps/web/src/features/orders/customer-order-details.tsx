"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { fetchOrder, OrderRequestError } from "./orders-client";
import { getPathaoCustomerTracking } from "./pathao-client";
import type { PathaoCustomerTracking } from "@aaraj/contracts";
import {
  sendEcommerceEvent,
  variantEcommerceItem,
} from "@/features/analytics/gtm-ecommerce";

export function CustomerOrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<PathaoCustomerTracking | null>(null);
  const [trackingUnavailable, setTrackingUnavailable] = useState(false);
  const purchaseTracked = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchOrder(orderId)
      .then((result) => {
        if (active) setOrder(result);
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
    if (
      !order ||
      !["awaiting_confirmation", "confirmed"].includes(order.status) ||
      purchaseTracked.current === order.id
    ) {
      return;
    }
    purchaseTracked.current = order.id;
    sendEcommerceEvent(
      "purchase",
      {
        transaction_id: order.reference,
        currency: order.currency,
        value: order.merchandiseGrossBdt,
        shipping: order.delivery.grossAmountBdt,
        items: order.lines.map((line) =>
          variantEcommerceItem({
            variantId: line.variantId,
            itemName: line.productName,
            color: line.color,
            sizeLabel: line.sizeLabel,
            price: line.unitPriceBdt,
            quantity: line.quantity,
          }),
        ),
      },
      order.id,
    );
  }, [order]);

  useEffect(() => {
    if (order?.dispatch?.deliveryProvider !== "pathao") return;

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
    order?.dispatch?.deliveryProvider,
    order?.dispatch?.dispatchedAt,
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
          <p className="text-sm text-muted-foreground" role="status">
            Loading order…
          </p>
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
              <h2
                className="text-sm font-semibold"
                id="order-items-heading"
              >
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
                    <span className="whitespace-nowrap">
                      {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
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
                    order.address.locality,
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

            {order.dispatch && (
              <section
                aria-label="Dispatch details"
                className="border-t border-border py-6"
              >
                <h2 className="text-sm font-semibold">Delivery</h2>
                <dl className="mt-3 grid gap-2 text-sm">
                  <DataRow
                    label="Courier"
                    value={order.dispatch.deliveryOperator}
                  />
                  <DataRow
                    label="Dispatched"
                    value={formatDateTime(order.dispatch.dispatchedAt)}
                  />
                  {order.dispatch.handoffReference && (
                    <DataRow
                      label="Handoff reference"
                      value={order.dispatch.handoffReference}
                    />
                  )}
                  <DataRow
                    label="Delivery status"
                    value={humanizeTracking(order.fulfillmentStatus)}
                  />
                </dl>
              </section>
            )}

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
                    value={humanizeTracking(tracking.booking.trackingProgress)}
                  />
                </dl>
                {tracking.observations.length > 0 && (
                  <ol className="mt-3 divide-y divide-border text-sm">
                    {tracking.observations.map((observation) => (
                      <li
                        className="py-2 text-muted-foreground"
                        key={`${observation.event}-${observation.receivedAt}`}
                      >
                        {humanizeTracking(observation.event)} ·{" "}
                        {formatDateTime(observation.receivedAt)}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {trackingUnavailable &&
              order.dispatch?.deliveryProvider === "pathao" && (
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
      message:
        order.cancellationReason === "serviceability_review_timeout"
          ? `This order was cancelled under the previous review policy${cancelledDate}. No payment is due.`
          : `AARAJ cancelled this order before dispatch${cancelledDate}. No payment is due.`,
    };
  }

  if (order.status === "rejected") {
    return {
      title: "Delivery unavailable",
      statusLabel: "Order closed",
      statusClass: "bg-muted text-muted-foreground",
      message:
        "We’re unable to deliver to this address, so the order was closed. No payment is due.",
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

  if (order.dispatch) {
    return {
      title: "Order dispatched",
      statusLabel: "With courier",
      statusClass: "bg-muted text-foreground",
      message: `Handed to ${order.dispatch.deliveryOperator} on ${formatDateTime(order.dispatch.dispatchedAt)}.`,
    };
  }

  if (order.serviceability === "pending_manual_review") {
    return {
      title: "Order received",
      statusLabel: "Delivery review in progress",
      statusClass:
        "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
      message:
        "We’re checking whether delivery is available to your address. Your order is not yet confirmed for dispatch.",
    };
  }

  if (order.serviceability === "serviceable") {
    return {
      title: "Delivery confirmed",
      statusLabel: "Preparing for dispatch",
      statusClass: "bg-muted text-foreground",
      message: "We’re preparing your order for dispatch.",
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
  if (order.status === "cancelled" || order.status === "rejected") {
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
    detail: "Cash on Delivery · Uncollected; no payment was taken at checkout",
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

function humanizeTracking(value: string): string {
  return value
    .replace(/^order\./, "")
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
