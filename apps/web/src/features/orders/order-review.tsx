"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { OrderDispatchInputSchema, type Order } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCatalogPrice } from "@/features/catalog/price";
import {
  dispatchCodOrder,
  OrderRequestError,
  updateOrderServiceability,
} from "./orders-client";
import { humanize } from "./orders-manager";
import {
  PathaoBookingPanel,
  type PathaoAssignmentState,
} from "./pathao-booking-panel";

export function OrderReview({ initialOrder }: { initialOrder: Order }) {
  const [order, setOrder] = useState(initialOrder);
  const [reason, setReason] = useState("");
  const [deliveryOperator, setDeliveryOperator] = useState("");
  const [handoffReference, setHandoffReference] = useState("");
  const [dispatchAttempted, setDispatchAttempted] = useState(false);
  const [pathaoAssignment, setPathaoAssignment] =
    useState<PathaoAssignmentState>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatchCommand = useRef<{ fingerprint: string; id: string } | null>(
    null,
  );

  async function decide(outcome: "serviceable" | "unserviceable") {
    setPending(true);
    setError(null);
    try {
      setOrder(await updateOrderServiceability(order.id, { outcome, reason }));
      setReason("");
    } catch (reasonError) {
      setError(
        reasonError instanceof OrderRequestError || reasonError instanceof Error
          ? reasonError.message
          : "The serviceability decision could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function dispatch() {
    const reference = handoffReference.trim();
    const input = OrderDispatchInputSchema.parse({
      deliveryProvider: pathaoAssignment === "booked" ? "pathao" : "manual",
      deliveryOperator,
      ...(reference ? { handoffReference: reference } : {}),
    });
    const fingerprint = JSON.stringify(input);
    let command = dispatchCommand.current;
    if (command?.fingerprint !== fingerprint) {
      command = {
        fingerprint,
        id: crypto.randomUUID(),
      };
      dispatchCommand.current = command;
      setDispatchAttempted(true);
    }

    setPending(true);
    setError(null);
    try {
      setOrder(await dispatchCodOrder(order.id, input, command.id));
    } catch (reasonError) {
      setError(
        reasonError instanceof OrderRequestError
          ? reasonError.message
          : "The dispatch could not be confirmed. Retry with the same details.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <article className="mx-auto max-w-4xl">
        <Link className="text-sm text-primary underline" href="/admin/orders">
          ← Back to Orders
        </Link>
        <p className="mt-7 text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ORDER REVIEW
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{order.reference}</h1>
        <section className="mt-6 grid gap-5 rounded-2xl border border-border p-5 sm:grid-cols-2 sm:p-7">
          <div>
            <h2 className="font-semibold">Order state</h2>
            <p className="mt-2">
              {humanize(order.status)} · {humanize(order.serviceability)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {humanize(order.fulfillmentStatus)} · COD uncollected
            </p>
          </div>
          <div>
            <h2 className="font-semibold">
              {order.status === "cancelled" || order.status === "rejected"
                ? "COD amount"
                : "COD amount due"}
            </h2>
            <p className="mt-2 text-xl font-semibold">
              {order.status === "cancelled" || order.status === "rejected"
                ? "Not payable"
                : formatCatalogPrice({ amountBdt: order.codAmountDueBdt })}
            </p>
            <p className="text-sm text-muted-foreground">
              No payment has been collected.
            </p>
          </div>
          <div className="sm:col-span-2">
            <h2 className="font-semibold">Recipient and delivery address</h2>
            <address className="mt-2 not-italic leading-6">
              {order.address.recipientName} · {order.address.phone}
              <br />
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
              {order.address.instructions ? (
                <>
                  <br />
                  Instructions: {order.address.instructions}
                </>
              ) : null}
            </address>
          </div>
          <div className="sm:col-span-2">
            <h2 className="font-semibold">Items</h2>
            <ul className="mt-2 divide-y divide-border">
              {order.lines.map((line) => (
                <li
                  className="flex justify-between gap-4 py-2"
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
          </div>
        </section>
        {order.status === "cancelled" && (
          <p className="mt-6 rounded-xl border border-border p-5 text-sm">
            Automatically cancelled because serviceability was not reviewed by
            its deadline. The stock reservation was released.
          </p>
        )}
        <PathaoBookingPanel
          onAssignmentStateChange={setPathaoAssignment}
          order={order}
        />
        {order.status === "awaiting_confirmation" &&
          order.serviceability === "pending_manual_review" && (
            <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
              <h2 className="text-xl font-semibold">
                Manual serviceability review
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirm the destination can be served. Marking it unserviceable
                rejects the Order and releases its stock reservation. Do not
                enter customer contact or address details in the decision note.
                Review within 7 days of Order creation. If it is still pending
                after 7 days, the system cancels it and releases the stock
                reservation.
              </p>
              {error && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <label className="mt-4 grid gap-2 text-sm font-medium">
                Decision note
                <Textarea
                  maxLength={500}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  disabled={pending || reason.trim().length < 3}
                  onClick={() => void decide("serviceable")}
                >
                  {pending ? "Saving…" : "Confirm serviceable"}
                </Button>
                <Button
                  disabled={pending || reason.trim().length < 3}
                  variant="destructive"
                  onClick={() => void decide("unserviceable")}
                >
                  {pending ? "Saving…" : "Reject as unserviceable"}
                </Button>
              </div>
            </section>
          )}
        {order.status === "confirmed" &&
          order.serviceability === "serviceable" &&
          order.fulfillmentStatus === "awaiting_dispatch" && (
            <section
              aria-label="Dispatch Order"
              className="mt-6 rounded-2xl border border-border p-5 sm:p-7"
            >
              <h2 className="text-xl font-semibold">Dispatch Order</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Record the delivery operator and the handoff reference if one
                was supplied. Dispatch consumes the held stock and does not
                confirm delivery or COD collection.
              </p>
              {error && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <label className="mt-4 grid gap-2 text-sm font-medium">
                Delivery operator
                <Input
                  autoComplete="organization"
                  maxLength={120}
                  minLength={2}
                  required
                  value={deliveryOperator}
                  onChange={(event) => setDeliveryOperator(event.target.value)}
                />
              </label>
              <label className="mt-4 grid gap-2 text-sm font-medium">
                Handoff reference (optional)
                <Input
                  maxLength={160}
                  value={handoffReference}
                  onChange={(event) => setHandoffReference(event.target.value)}
                />
              </label>
              <Button
                className="mt-5"
                disabled={
                  pending ||
                  deliveryOperator.trim().length < 2 ||
                  (pathaoAssignment !== "none" && pathaoAssignment !== "booked")
                }
                onClick={() => void dispatch()}
              >
                {pending
                  ? "Recording dispatch…"
                  : dispatchAttempted
                    ? "Retry dispatch"
                    : "Record dispatch"}
              </Button>
              {pathaoAssignment !== "none" && pathaoAssignment !== "booked" && (
                <p className="mt-2 text-sm text-muted-foreground" role="status">
                  {pathaoAssignment === "loading"
                    ? "Checking Pathao assignment before dispatch…"
                    : pathaoAssignment === "unavailable"
                      ? "Pathao assignment could not be checked. Refresh before dispatching."
                      : "Resolve the Pathao booking outcome before dispatching."}
                </p>
              )}
            </section>
          )}
        {order.fulfillmentStatus === "dispatched" && order.dispatch && (
          <section
            aria-label="Dispatch record"
            className="mt-6 rounded-2xl border border-border p-5 sm:p-7"
          >
            <h2 className="text-xl font-semibold">Dispatched</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Inventory was consumed once for this handoff. The Order remains
              COD, uncollected, and not yet delivered.
            </p>
            <dl className="mt-4 grid gap-2 text-sm">
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
                label="Dispatched at"
                value={formatDate(order.dispatch.dispatchedAt)}
              />
            </dl>
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
