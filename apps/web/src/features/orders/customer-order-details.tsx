"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { fetchOrder, OrderRequestError } from "./orders-client";
import { getPathaoCustomerTracking } from "./pathao-client";
import type { PathaoCustomerTracking } from "@aaraj/contracts";

export function CustomerOrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<PathaoCustomerTracking | null>(null);
  const [trackingUnavailable, setTrackingUnavailable] = useState(false);

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
              ? "Online Order access is unavailable. A lost or expired guest access cookie cannot be recovered automatically. Contact AARAJ through its published support channels; support will not disclose private Order details without a separately approved identity verification process."
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
  }, [orderId]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-12 text-foreground sm:py-16">
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold tracking-[0.16em] text-primary">
          AARAJ ORDER
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Order details
        </h1>
        {error ? (
          <section className="mt-7 rounded-2xl border border-border p-6">
            <p role="alert">{error}</p>
            <Link
              className="mt-5 inline-block text-primary underline"
              href="/shop"
            >
              Continue shopping
            </Link>
          </section>
        ) : !order ? (
          <p className="mt-7" role="status">
            Loading Order…
          </p>
        ) : (
          <section className="mt-7 rounded-2xl border border-border p-5 sm:p-7">
            <p className="text-sm text-muted-foreground">Order reference</p>
            <p
              className="mt-1 text-2xl font-semibold"
              data-testid="order-reference"
            >
              {order.reference}
            </p>
            <p className="mt-3" role="status">
              {order.status === "cancelled"
                ? order.cancellationReason === "serviceability_review_timeout"
                  ? "Your Order was automatically cancelled because delivery serviceability was not reviewed by its deadline. Its stock reservation was released. Nothing is payable."
                  : "Your Order was cancelled by AARAJ before dispatch. Its stock reservation was released. Nothing is payable."
                : order.fulfillmentStatus === "delivered"
                  ? "Your Order is recorded as delivered. COD collection is tracked separately below."
                  : order.fulfillmentStatus === "partially_delivered"
                    ? "Your Order is recorded as partially delivered. COD collection is tracked separately below."
                    : order.fulfillmentStatus === "returned"
                      ? "Your Order is recorded as returned to the merchant. COD collection is tracked separately below."
                      : order.fulfillmentStatus === "delivery_failed"
                        ? "A delivery attempt was recorded as failed. AARAJ is reviewing the next delivery step."
                        : order.dispatch
                          ? `Your Order was handed to ${order.dispatch.deliveryOperator} on ${formatDateTime(order.dispatch.dispatchedAt)}. Delivery and COD collection are tracked separately.`
                          : order.serviceability === "pending_manual_review"
                            ? "Your Order is received and awaiting manual delivery serviceability review. It is not yet confirmed for dispatch. If it is still awaiting review after 7 days, it will be cancelled and its stock reservation released."
                            : order.serviceability === "serviceable"
                              ? "Delivery serviceability has been confirmed. AARAJ is preparing the Order for dispatch. If dispatch is delayed, we will verify any active courier booking before changing the Order."
                              : "AARAJ cannot deliver to this destination. This Order was rejected and its stock hold was released."}
            </p>
            <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
              <DataRow label="Payment method" value="Cash on Delivery" />
              <DataRow
                label="Collection status"
                value={
                  order.collectionStatus === "uncollected"
                    ? "Uncollected; no payment was taken at checkout"
                    : order.collectionStatus === "collected"
                      ? `Collected ${formatBdtPrice({ amountBdt: order.collectedAmountBdt ?? 0 })}`
                      : `Collection amount under reconciliation: ${formatBdtPrice({ amountBdt: order.collectedAmountBdt ?? 0 })}`
                }
              />
              <DataRow
                label="COD due on delivery"
                value={
                  order.status === "cancelled" || order.status === "rejected"
                    ? "Not payable; Order closed"
                    : order.collectionStatus === "collected"
                      ? "Collected"
                      : order.collectionStatus === "discrepancy"
                        ? "Under reconciliation"
                        : formatBdtPrice({ amountBdt: order.codAmountDueBdt })
                }
              />
              <DataRow
                label="Order total"
                value={formatBdtPrice({ amountBdt: order.totalBdt })}
              />
            </dl>
            {order.dispatch && (
              <section
                aria-label="Dispatch details"
                className="mt-5 rounded-xl border border-border p-4"
              >
                <h2 className="font-semibold">Dispatch details</h2>
                <dl className="mt-3 grid gap-2 text-sm">
                  <DataRow
                    label="Delivery operator"
                    value={order.dispatch.deliveryOperator}
                  />
                  {order.dispatch.handoffReference && (
                    <DataRow
                      label="Handoff reference"
                      value={order.dispatch.handoffReference}
                    />
                  )}
                  <DataRow
                    label="Handed over"
                    value={formatDateTime(order.dispatch.dispatchedAt)}
                  />
                  <DataRow
                    label="Delivery status"
                    value={humanizeTracking(order.fulfillmentStatus)}
                  />
                </dl>
              </section>
            )}
            {tracking?.booking && (
              <section
                aria-label="Pathao delivery tracking"
                className="mt-5 rounded-xl border border-border p-4"
              >
                <h2 className="font-semibold">Pathao delivery tracking</h2>
                <dl className="mt-3 grid gap-2 text-sm">
                  <DataRow
                    label="Consignment"
                    value={tracking.booking.consignmentId}
                  />
                  <DataRow
                    label="Latest verified progress"
                    value={humanizeTracking(tracking.booking.trackingProgress)}
                  />
                  <DataRow
                    label="COD due"
                    value={formatBdtPrice({
                      amountBdt: order.codAmountDueBdt,
                    })}
                  />
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Courier tracking does not itself confirm COD collection or
                  merchant remittance. The collection status above reflects
                  AARAJ&apos;s separate staff-verified reconciliation.
                </p>
                {tracking.observations.length > 0 && (
                  <ol className="mt-4 divide-y divide-border text-sm">
                    {tracking.observations.map((observation) => (
                      <li
                        className="py-2"
                        key={`${observation.event}-${observation.receivedAt}`}
                      >
                        {humanizeTracking(observation.event)} · verified{" "}
                        {formatDateTime(observation.receivedAt)}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
            {trackingUnavailable && (
              <p className="mt-4 text-sm text-muted-foreground" role="status">
                Courier tracking is temporarily unavailable. Your Order and COD
                amount are unchanged.
              </p>
            )}
            {order.cancellationReason === "serviceability_review_timeout" &&
              order.cancelledAt && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Cancelled on {formatDateTime(order.cancelledAt)} because the
                  delivery review deadline passed.
                </p>
              )}
            <h2 className="mt-7 text-lg font-semibold">Items</h2>
            <ul className="mt-2 divide-y divide-border">
              {order.lines.map((line) => (
                <li
                  className="flex justify-between gap-4 py-3"
                  key={line.variantId}
                >
                  <span>
                    {line.productName} · {line.color} · {line.sizeLabel} ×{" "}
                    {line.quantity}
                  </span>
                  <span>
                    {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                  </span>
                </li>
              ))}
            </ul>
            <h2 className="mt-7 text-lg font-semibold">Delivery address</h2>
            <address className="mt-2 not-italic leading-6 text-secondary-foreground">
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
                <span className="mt-2 block">
                  Delivery instructions: {order.address.instructions}
                </span>
              )}
            </address>
            {order.guestAccessExpiresAt && (
              <p className="mt-6 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Guest tracking is available in this browser until{" "}
                {formatDateTime(order.guestAccessExpiresAt)}. Clearing browser
                cookies or using another device may remove access. Lost or
                expired access cannot be restored automatically.
              </p>
            )}
            <Link
              className="mt-6 inline-block text-primary underline"
              href="/shop"
            >
              Continue shopping
            </Link>
          </section>
        )}
      </article>
    </main>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
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
