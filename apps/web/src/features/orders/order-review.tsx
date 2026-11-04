"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import {
  OrderDispatchInputSchema,
  type Order,
  type OrderManagementDetail,
  type OrderStatusAction,
  type OrderStatusUpdateInput,
  type OrderDispatchInput,
  type OrderFulfillmentOutcomeInput,
} from "@aaraj/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBdtPrice } from "@/lib/currency";
import {
  dispatchCodOrder,
  OrderRequestError,
  recordOrderCodCollection,
  recordOrderFulfillmentOutcome,
  updateOrderStatus,
} from "./orders-client";
import { humanize, humanizeFulfillmentStatus } from "./orders-format";
import { OrderStatusBadge } from "./order-status-badges";
import { PathaoBookingPanel } from "./pathao-booking-panel";
import { OrderStatusMenu } from "./order-status-menu";

type OrderReviewOrder = Order & {
  availableStatusActions?: OrderStatusAction[];
};

export function OrderReview({
  initialOrder,
}: {
  initialOrder: OrderManagementDetail;
}) {
  const [order, setOrder] = useState<OrderReviewOrder>(initialOrder);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelFormOpen, setCancelFormOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [outcomeReason, setOutcomeReason] = useState("");
  const [collectionReason, setCollectionReason] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatchCommand = useRef<{ fingerprint: string; id: string } | null>(
    null,
  );

  function applyOrderUpdate(updatedOrder: Order) {
    setOrder(updatedOrder);
  }

  async function updateStatus(input: OrderStatusUpdateInput) {
    setPending(true);
    setError(null);
    try {
      applyOrderUpdate(await updateOrderStatus(order.id, input));
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "The order status could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  async function saveDispatch(input: OrderDispatchInput) {
    const fingerprint = JSON.stringify(input);
    let command = dispatchCommand.current;
    if (command?.fingerprint !== fingerprint) {
      command = {
        fingerprint,
        id: crypto.randomUUID(),
      };
      dispatchCommand.current = command;
    }

    setPending(true);
    setError(null);
    try {
      applyOrderUpdate(await dispatchCodOrder(order.id, input, command.id));
    } catch (reasonError) {
      setError(
        reasonError instanceof OrderRequestError
          ? reasonError.message
          : "The courier pickup could not be recorded. Retry with the same details.",
      );
    } finally {
      setPending(false);
    }
  }

  async function recordPathaoPickup(consignmentId: string) {
    const input = OrderDispatchInputSchema.parse({
      deliveryProvider: "pathao",
      deliveryOperator: "Pathao Courier",
      handoffReference: consignmentId,
    });
    await saveDispatch(input);
  }

  async function cancelBeforeDispatch() {
    setPending(true);
    setCancelError(null);
    try {
      applyOrderUpdate(
        await updateOrderStatus(order.id, {
          status: "cancelled",
          reason: cancelReason.trim(),
        }),
      );
      setCancelReason("");
      setCancelFormOpen(false);
    } catch (reasonError) {
      setCancelError(
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
      applyOrderUpdate(
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
      applyOrderUpdate(
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
  const canConfirmOrder = order.availableStatusActions?.includes("confirmed");
  const canPutOnHold = order.availableStatusActions?.includes("on_hold");
  const canMarkNoAnswer = order.availableStatusActions?.includes("no_answer");
  const canCancelBeforeDispatch =
    order.availableStatusActions?.includes("cancelled");
  const canReopenAsPending = order.availableStatusActions?.includes("pending");
  const canManageCustomerDecision =
    canConfirmOrder ||
    canPutOnHold ||
    canMarkNoAnswer ||
    canCancelBeforeDispatch ||
    canReopenAsPending;
  const showFulfillmentStatus = !(
    order.fulfillmentStatus === "dispatched" &&
    order.courierHandoff?.deliveryProvider === "pathao"
  );

  return (
    <>
      <article>
        <AdminPageHeader
          backLink={
            <Link className={adminPageLinkClassName} href="/admin/orders">
              ← Back to orders
            </Link>
          }
          title={order.reference}
          description="Review fulfillment, delivery, and COD collection."
        />
        <section className="mt-6 grid gap-5 rounded-2xl border border-border p-5 sm:grid-cols-2 sm:p-7">
          <div>
            <h2 className="font-semibold">Order status</h2>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <OrderStatusBadge status={order.status} />
              <OrderStatusMenu
                actions={order.availableStatusActions ?? []}
                disabled={pending}
                onSelect={(action) => {
                  if (action === "cancelled") {
                    setError(null);
                    setCancelError(null);
                    setCancelReason("");
                    setCancelFormOpen(true);
                  } else {
                    void updateStatus({ status: action });
                  }
                }}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {showFulfillmentStatus
                ? `${humanizeFulfillmentStatus(order.fulfillmentStatus)} · `
                : ""}
              COD {humanize(order.collectionStatus)}
              {order.collectedAmountBdt !== null
                ? ` (${order.collectedAmountBdt} / ${order.codAmountDueBdt} BDT)`
                : ""}
            </p>
          </div>
          <div>
            <h2 className="font-semibold">COD amount due</h2>
            <p className="mt-2 text-xl font-semibold">
              {formatBdtPrice({ amountBdt: order.codAmountDueBdt })}
            </p>
            {order.collectionStatus !== "uncollected" && (
              <p className="text-sm text-muted-foreground">
                {order.collectionStatus === "collected"
                  ? `AARAJ recorded ${order.collectedAmountBdt} BDT collected.`
                  : `AARAJ recorded ${order.collectedAmountBdt} BDT; the amount is under reconciliation.`}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <h2 className="font-semibold">Recipient and delivery address</h2>
            <address className="mt-2 not-italic leading-6">
              {order.address.recipientName} ·{" "}
              <a
                aria-label={`Call ${order.address.recipientName} at ${order.address.phone}`}
                className="underline underline-offset-4"
                href={`tel:${order.address.phone}`}
              >
                {order.address.phone}
              </a>
              <br />
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
        <AlertDialog
          open={cancelFormOpen && canCancelBeforeDispatch}
          onOpenChange={(open) => {
            if (open || pending) return;
            setCancelFormOpen(false);
            setCancelReason("");
            setCancelError(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
              <AlertDialogDescription>
                Cancelling releases the reserved stock and closes the order.
                Orders can only be cancelled before courier booking or handoff.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              Cancellation reason
              <Textarea
                autoFocus
                maxLength={500}
                minLength={3}
                required
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </label>
            {cancelError && (
              <p className="text-sm text-destructive" role="alert">
                {cancelError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                Keep order
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={pending || cancelReason.trim().length < 3}
                onClick={() => void cancelBeforeDispatch()}
                variant="destructive"
              >
                {pending ? "Cancelling…" : "Cancel order"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {order.status === "cancelled" && (
          <p className="mt-6 rounded-xl border border-border p-5 text-sm">
            Cancelled by authorized staff before courier pickup. The stock
            reservation was released.
          </p>
        )}
        <PathaoBookingPanel
          handoffError={error}
          handoffPending={pending}
          onRecordPickup={recordPathaoPickup}
          order={order}
        />
        {canManageCustomerDecision && (
          <section className="mt-6 rounded-2xl border border-border p-5 sm:p-7">
            <h2 className="text-xl font-semibold">
              {order.status === "on_hold"
                ? "Order on hold"
                : order.status === "confirmed"
                  ? "Confirmed order"
                  : order.status === "no_answer"
                    ? "No answer"
                    : "Customer contact"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {order.status === "on_hold"
                ? "The customer asked to pause this order. Confirm they still want it and recheck the delivery details before resuming. The reserved stock remains held."
                : order.status === "confirmed"
                  ? "The customer can still request a pause before courier pickup. Putting the order on hold keeps the stock reserved."
                  : order.status === "no_answer"
                    ? "The customer did not answer the call. The order remains pending and its stock stays reserved. Try again before courier pickup."
                    : "Call the customer using the number above. Confirm the items and delivery details. Put the order on hold if they ask to wait, or cancel it if they no longer want it."}
            </p>
            {error && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
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
    </>
  );
}
