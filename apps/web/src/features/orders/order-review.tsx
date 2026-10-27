"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  OrderDispatchInputSchema,
  type Order,
  type OrderFulfillmentOutcomeInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import {
  cancelAwaitingDispatchOrder,
  dispatchCodOrder,
  OrderRequestError,
  recordOrderCodCollection,
  recordOrderFulfillmentOutcome,
  updateOrderServiceability,
} from "./orders-client";
import { humanize } from "./orders-format";
import {
  PathaoBookingPanel,
  type PathaoAssignmentState,
} from "./pathao-booking-panel";

export function OrderReview({ initialOrder }: { initialOrder: Order }) {
  const [order, setOrder] = useState(initialOrder);
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [outcomeReason, setOutcomeReason] = useState("");
  const [collectionReason, setCollectionReason] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
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

  async function cancelBeforeDispatch() {
    setPending(true);
    setError(null);
    try {
      setOrder(
        await cancelAwaitingDispatchOrder(order.id, {
          reason: cancelReason,
        }),
      );
      setCancelReason("");
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "The Order could not be cancelled.",
      );
    } finally {
      setPending(false);
    }
  }

  async function recordOutcome(
    outcome: OrderFulfillmentOutcomeInput["outcome"],
  ) {
    setPending(true);
    setError(null);
    try {
      setOrder(
        await recordOrderFulfillmentOutcome(order.id, {
          outcome,
          reason: outcomeReason,
        }),
      );
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "The delivery outcome could not be recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  async function recordCollection() {
    setPending(true);
    setError(null);
    try {
      setOrder(
        await recordOrderCodCollection(order.id, {
          collectedAmountBdt: Number(collectionAmount),
          reason: collectionReason,
        }),
      );
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "The COD collection could not be recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  const availableOutcomes: OrderFulfillmentOutcomeInput["outcome"][] =
    order.fulfillmentStatus === "dispatched"
      ? ["partially_delivered", "delivered", "delivery_failed", "returned"]
      : order.fulfillmentStatus === "delivery_failed"
        ? ["delivery_failed", "partially_delivered", "delivered", "returned"]
        : order.fulfillmentStatus === "partially_delivered"
          ? ["partially_delivered", "delivered", "returned"]
          : [];

  return (
    <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-10 text-foreground sm:px-8 sm:py-12">
      <article className="mx-auto max-w-4xl">
        <Link className="text-sm text-primary underline" href="/admin/orders">
          ← Back to Orders
        </Link>
        <p className="mt-7 text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ORDER REVIEW
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Order ID</p>
        <h1 className="mt-1 text-3xl font-semibold">{order.reference}</h1>
        <section className="mt-6 grid gap-5 rounded-2xl border border-border p-5 sm:grid-cols-2 sm:p-7">
          <div>
            <h2 className="font-semibold">Order state</h2>
            <p className="mt-2">
              {humanize(order.status)} · {humanize(order.serviceability)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {humanize(order.fulfillmentStatus)} · COD{" "}
              {humanize(order.collectionStatus)}
              {order.collectedAmountBdt !== null
                ? ` (${order.collectedAmountBdt} / ${order.codAmountDueBdt} BDT)`
                : ""}
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
                : formatBdtPrice({ amountBdt: order.codAmountDueBdt })}
            </p>
            <p className="text-sm text-muted-foreground">
              {order.collectionStatus === "uncollected"
                ? "No COD collection has been recorded."
                : order.collectionStatus === "collected"
                  ? `AARAJ recorded ${order.collectedAmountBdt} BDT collected.`
                  : `AARAJ recorded ${order.collectedAmountBdt} BDT; the amount is under reconciliation.`}
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
                    {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        {order.status === "cancelled" && (
          <p className="mt-6 rounded-xl border border-border p-5 text-sm">
            {order.cancellationReason === "serviceability_review_timeout"
              ? "Automatically cancelled under the previous review policy. The stock reservation was released."
              : "Cancelled by authorized staff before dispatch. The stock reservation was released."}
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
        {order.status === "confirmed" &&
          order.fulfillmentStatus === "awaiting_dispatch" && (
            <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
              <h2 className="text-xl font-semibold">Cancel before dispatch</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                A Pathao booking claim blocks cancellation until its provider
                state can be verified and reconciled. Do not release its stock
                while that booking remains unresolved.
              </p>
              <label className="mt-4 grid gap-2 text-sm font-medium">
                Cancellation reason
                <Textarea
                  maxLength={500}
                  minLength={3}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </label>
              {error && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                className="mt-4"
                disabled={
                  pending ||
                  cancelReason.trim().length < 3 ||
                  pathaoAssignment !== "none"
                }
                variant="destructive"
                onClick={() => void cancelBeforeDispatch()}
              >
                {pending ? "Cancelling…" : "Cancel Order and release stock"}
              </Button>
              {pathaoAssignment !== "none" && (
                <p className="mt-2 text-sm text-muted-foreground" role="status">
                  {pathaoAssignment === "loading"
                    ? "Checking Pathao assignment before cancellation…"
                    : pathaoAssignment === "unavailable"
                      ? "Pathao assignment could not be checked. Refresh before cancelling."
                      : "This Order stays reserved while its Pathao booking claim is unresolved."}
                </p>
              )}
            </section>
          )}
        {order.dispatch && (
          <section
            aria-label="Dispatch record"
            className="mt-6 rounded-2xl border border-border p-5 sm:p-7"
          >
            <h2 className="text-xl font-semibold">Delivery record</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Inventory was consumed once at handoff. Record a delivery outcome
              after checking the courier or manual delivery evidence.
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
                value={formatDateTime(order.dispatch.dispatchedAt)}
              />
            </dl>
          </section>
        )}
        {availableOutcomes.length > 0 && (
          <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
            <h2 className="text-xl font-semibold">Record delivery outcome</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify the delivery result before saving. This updates the Order
              record but does not mark COD as collected.
            </p>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              Verification note
              <span className="text-xs text-muted-foreground">
                Do not include customer contact or address details.
              </span>
              <Textarea
                maxLength={500}
                minLength={3}
                value={outcomeReason}
                onChange={(event) => setOutcomeReason(event.target.value)}
              />
            </label>
            {error && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {availableOutcomes.map((outcome) => (
                <Button
                  disabled={pending || outcomeReason.trim().length < 3}
                  key={outcome}
                  variant={outcome === "returned" ? "destructive" : "default"}
                  onClick={() => void recordOutcome(outcome)}
                >
                  {pending ? "Saving…" : `Record ${humanize(outcome)}`}
                </Button>
              ))}
            </div>
          </section>
        )}
        {["partially_delivered", "delivered", "returned"].includes(
          order.fulfillmentStatus,
        ) && (
          <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
            <h2 className="text-xl font-semibold">Reconcile COD collection</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the amount verified from courier or cash records. A full
              match records collection; any difference remains flagged for
              reconciliation. This records customer collection, not merchant
              remittance.
            </p>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              Amount collected (BDT)
              <Input
                inputMode="numeric"
                min={0}
                type="number"
                value={collectionAmount}
                onChange={(event) => setCollectionAmount(event.target.value)}
              />
            </label>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              Verification note
              <span className="text-xs text-muted-foreground">
                Do not include customer contact or address details.
              </span>
              <Textarea
                maxLength={500}
                minLength={3}
                value={collectionReason}
                onChange={(event) => setCollectionReason(event.target.value)}
              />
            </label>
            {order.collectionStatus !== "uncollected" && (
              <p className="mt-3 text-sm" role="status">
                {humanize(order.collectionStatus)}: {order.collectedAmountBdt} /{" "}
                {order.codAmountDueBdt} BDT
              </p>
            )}
            {error && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              className="mt-4"
              disabled={
                pending ||
                collectionAmount === "" ||
                !Number.isSafeInteger(Number(collectionAmount)) ||
                Number(collectionAmount) < 0 ||
                collectionReason.trim().length < 3
              }
              onClick={() => void recordCollection()}
            >
              {pending ? "Saving…" : "Save COD reconciliation"}
            </Button>
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
