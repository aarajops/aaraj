"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { formatCatalogPrice } from "@/features/catalog/price";
import { fetchOrder, OrderRequestError } from "./orders-client";

export function CustomerOrderDetails({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <Link className="mt-5 inline-block text-primary underline" href="/">
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
                ? "Your Order was automatically cancelled because delivery serviceability was not reviewed by its deadline. Its stock reservation was released. Nothing is payable."
                : order.serviceability === "pending_manual_review"
                  ? "Your Order is received and awaiting manual delivery serviceability review. It is not yet confirmed for dispatch. If it is still awaiting review after 7 days, it will be cancelled and its stock reservation released."
                  : order.serviceability === "serviceable"
                    ? "Delivery serviceability has been confirmed. AARAJ will prepare the Order for dispatch."
                    : "AARAJ cannot deliver to this destination. This Order was rejected and its stock hold was released."}
            </p>
            <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
              <DataRow label="Payment method" value="Cash on Delivery" />
              <DataRow
                label="Collection status"
                value="Uncollected; no payment was taken at checkout"
              />
              <DataRow
                label="COD due on delivery"
                value={
                  order.status === "cancelled" || order.status === "rejected"
                    ? "Not payable; Order closed"
                    : formatCatalogPrice({ amountBdt: order.codAmountDueBdt })
                }
              />
              <DataRow
                label="Order total"
                value={formatCatalogPrice({ amountBdt: order.totalBdt })}
              />
            </dl>
            {order.cancellationReason === "serviceability_review_timeout" &&
              order.cancelledAt && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Cancelled on {formatDate(order.cancelledAt)} because the
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
                    {formatCatalogPrice({ amountBdt: line.grossAmountBdt })}
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
                {formatDate(order.guestAccessExpiresAt)}. Clearing browser
                cookies or using another device may remove access. Lost or
                expired access cannot be restored automatically.
              </p>
            )}
            <Link className="mt-6 inline-block text-primary underline" href="/">
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}
