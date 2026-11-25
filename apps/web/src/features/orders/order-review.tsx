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
  type OrderComboFulfillmentOutcomeInput,
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
  recordOrderComboFulfillmentOutcome,
  recordOrderFulfillmentOutcome,
  updateOrderStatus,
} from "./orders-client";
import {
  comboSelectionInputKey,
  getAcceptedComboQuantity,
  getAcceptedComboSelection,
  hasRecordedAcceptedQuantity,
  getOrderComboBillableAmount,
  getOrderLineAcceptedAmount,
  getOrderLineAcceptedQuantity,
  humanize,
  humanizeFulfillmentStatus,
} from "./orders-format";
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
  const [comboOutcomeReasons, setComboOutcomeReasons] = useState<
    Record<string, string>
  >({});
  const [comboAcceptedQuantities, setComboAcceptedQuantities] = useState<
    Record<string, Record<string, string>>
  >({});
  const [acceptedItemQuantities, setAcceptedItemQuantities] = useState<
    Record<string, string>
  >({});
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
    if (outcome !== "delivered" && !acceptedItemQuantitiesAreValid) return;
    const acceptedItems = order.lines
      .filter((line) => line.comboGroupId === null)
      .flatMap((line) => {
        const quantity =
          outcome === "delivered"
            ? line.quantity
            : Number(
                acceptedItemQuantities[line.variantId] ??
                  line.acceptedQuantity ??
                  0,
              ) || 0;
        return quantity > 0 ? [{ variantId: line.variantId, quantity }] : [];
      });
    setPending(true);
    setError(null);
    try {
      applyOrderUpdate(
        await recordOrderFulfillmentOutcome(order.id, {
          outcome,
          reason: outcomeReason,
          acceptedItems,
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

  async function recordComboOutcome(
    groupId: string,
    outcome: OrderComboFulfillmentOutcomeInput["outcome"],
  ) {
    const reason = comboOutcomeReasons[groupId] ?? "";
    const group = order.comboGroups.find(
      (candidate) => candidate.id === groupId,
    );
    const acceptedComponents =
      outcome === "incomplete" || outcome === "declined"
        ? (group?.selections ?? []).flatMap((selection) => {
            const key = comboSelectionInputKey(selection);
            const quantity = Number(
              comboAcceptedQuantities[groupId]?.[key] ??
                (group
                  ? getAcceptedComboQuantity(group, selection)
                  : undefined) ??
                0,
            );
            return quantity > 0
              ? [
                  {
                    componentId: selection.componentId,
                    ...(selection.selectionIndex === undefined
                      ? {}
                      : { selectionIndex: selection.selectionIndex }),
                    quantity,
                  },
                ]
              : [];
          })
        : [];
    setPending(true);
    setError(null);
    try {
      applyOrderUpdate(
        await recordOrderComboFulfillmentOutcome(order.id, {
          groupId,
          outcome,
          reason,
          acceptedComponents,
        }),
      );
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "The combo delivery outcome could not be recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  const availableOutcomes: OrderFulfillmentOutcomeInput["outcome"][] =
    order.collectionStatus !== "uncollected"
      ? []
      : order.fulfillmentStatus === "dispatched"
        ? ["partially_delivered", "delivered", "delivery_failed", "returned"]
        : order.fulfillmentStatus === "delivery_failed"
          ? ["delivery_failed", "partially_delivered", "delivered", "returned"]
          : order.fulfillmentStatus === "partially_delivered"
            ? ["partially_delivered", "delivered", "returned"]
            : [];
  const acceptedItemQuantitiesAreValid = order.lines
    .filter((line) => line.comboGroupId === null)
    .every((line) => {
      const value =
        acceptedItemQuantities[line.variantId] ?? line.acceptedQuantity ?? 0;
      const quantity = value === "" ? 0 : Number(value);
      return (
        Number.isInteger(quantity) && quantity >= 0 && quantity <= line.quantity
      );
    });
  const canConfirmOrder = order.availableStatusActions?.includes("confirmed");
  const canPutOnHold = order.availableStatusActions?.includes("on_hold");
  const canMarkNoAnswer = order.availableStatusActions?.includes("no_answer");
  const canCancelBeforeDispatch =
    order.availableStatusActions?.includes("cancelled");
  const canReopenAsPending = order.availableStatusActions?.includes("pending");
  const hasUnresolvedComboOutcomes = order.comboGroups.some(
    ({ deliveryOutcome }) =>
      deliveryOutcome === "pending" || deliveryOutcome === "incomplete",
  );
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
      <article className="mx-auto max-w-6xl space-y-5">
        <AdminPageHeader
          backLink={
            <Link className={adminPageLinkClassName} href="/admin/orders">
              ← Back to orders
            </Link>
          }
          title={order.reference}
          description="Review fulfillment, delivery, and COD collection."
        />
        <section className="overflow-hidden rounded-2xl border border-border bg-card/70">
          <div className="grid gap-5 border-b border-border p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-semibold">Order status</h2>
                <OrderStatusBadge status={order.status} />
                <OrderStatusMenu
                  actions={order.availableStatusActions ?? []}
                  currentStatus={order.status}
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
              <p className="mt-2 text-sm text-muted-foreground">
                {showFulfillmentStatus
                  ? `${humanizeFulfillmentStatus(order.fulfillmentStatus)} · `
                  : ""}
                COD {humanize(order.collectionStatus)}
                {order.collectedAmountBdt !== null
                  ? ` (${formatBdtPrice({ amountBdt: order.collectedAmountBdt })} / ${formatBdtPrice({ amountBdt: order.codAmountDueBdt })})`
                  : ""}
              </p>
            </div>
            <div className="sm:border-l sm:border-border sm:pl-6 sm:text-right">
              <h2 className="text-sm font-medium text-muted-foreground">
                COD amount due
              </h2>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatBdtPrice({ amountBdt: order.codAmountDueBdt })}
              </p>
              {order.collectionStatus !== "uncollected" && (
                <p className="mt-1 text-sm text-muted-foreground sm:max-w-xs">
                  {order.collectionStatus === "collected"
                    ? `AARAJ recorded ${formatBdtPrice({ amountBdt: order.collectedAmountBdt! })} collected.`
                    : `AARAJ recorded ${formatBdtPrice({ amountBdt: order.collectedAmountBdt! })}; the amount is under reconciliation.`}
                </p>
              )}
            </div>
          </div>
          <div className="grid min-w-0 gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section
              className="min-w-0"
              aria-labelledby="order-recipient-heading"
            >
              <h2 className="font-semibold" id="order-recipient-heading">
                Recipient and delivery address
              </h2>
              <address className="mt-2 break-words not-italic leading-6">
                <span className="font-medium">
                  {order.address.recipientName}
                </span>
                <br />
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
                    <span className="text-muted-foreground">
                      Instructions:
                    </span>{" "}
                    {order.address.instructions}
                  </>
                ) : null}
              </address>
            </section>
            <section className="min-w-0" aria-labelledby="order-items-heading">
              <h2 className="font-semibold" id="order-items-heading">
                Items
              </h2>
              <ul className="mt-2 divide-y divide-border">
                {order.lines
                  .filter((line) => line.comboGroupId === null)
                  .map((line) => (
                    <li
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2 sm:gap-4"
                      key={line.variantId}
                    >
                      <span className="min-w-0 break-words">
                        {line.productName} · {line.color} · {line.sizeLabel} ×{" "}
                        {line.quantity}
                        {hasRecordedAcceptedQuantity(line)
                          ? ` · accepted ${line.acceptedQuantity}`
                          : ""}
                      </span>
                      <span className="grid shrink-0 justify-items-end text-right tabular-nums">
                        {formatBdtPrice({
                          amountBdt: getOrderLineAcceptedAmount(order, line),
                        })}
                        {line.compareAtPriceBdt !== null &&
                          line.compareAtPriceBdt > line.unitPriceBdt &&
                          getOrderLineAcceptedQuantity(order, line) > 0 && (
                            <del className="text-xs text-muted-foreground">
                              {formatBdtPrice({
                                amountBdt:
                                  line.compareAtPriceBdt *
                                  getOrderLineAcceptedQuantity(order, line),
                              })}
                            </del>
                          )}
                      </span>
                    </li>
                  ))}
                {order.comboGroups.map((group) => (
                  <li className="grid gap-2 py-3" key={group.id}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <span>
                        <span className="block font-medium">
                          {group.comboName}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          Sold as a complete set. · Qty {group.quantity}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatBdtPrice({
                          amountBdt: getOrderComboBillableAmount(order, group),
                        })}
                      </span>
                    </div>
                    <ul className="ml-3 list-disc text-sm text-muted-foreground">
                      {group.selections.map((selection) => (
                        <li
                          key={
                            selection.selectionIndex ?? selection.componentId
                          }
                        >
                          {selection.productName} · {selection.color} ·{" "}
                          {selection.sizeLabel}
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm">
                      Delivery status: {humanize(group.deliveryOutcome)}
                    </p>
                    {group.outcomeReason && (
                      <p className="text-xs text-muted-foreground">
                        Note: {group.outcomeReason}
                      </p>
                    )}
                    {group.acceptedComponents.length > 0 && (
                      <p className="text-sm">
                        Received items:{" "}
                        {group.acceptedComponents
                          .map((accepted) => {
                            const selection = getAcceptedComboSelection(
                              group,
                              accepted,
                            );
                            return selection
                              ? `${selection.productName} · ${selection.color} · ${selection.sizeLabel} × ${accepted.quantity}`
                              : null;
                          })
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    )}
                    {order.status === "confirmed" &&
                      ["partially_delivered", "delivered", "returned"].includes(
                        order.fulfillmentStatus,
                      ) &&
                      order.collectionStatus === "uncollected" &&
                      ![
                        "complete",
                        "redelivered_complete",
                        "declined",
                      ].includes(group.deliveryOutcome) && (
                        <div className="grid gap-2 rounded-md border border-border p-3">
                          <label className="grid gap-2 text-sm font-medium">
                            Combo delivery note
                            <Textarea
                              maxLength={500}
                              minLength={3}
                              value={comboOutcomeReasons[group.id] ?? ""}
                              onChange={(event) =>
                                setComboOutcomeReasons((current) => ({
                                  ...current,
                                  [group.id]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Record the quantity received for each selected item.
                            Complete sets use the combo price; accepted items
                            from incomplete sets use their individual prices.
                          </p>
                          <div className="grid gap-2">
                            {group.selections.map((selection, index) => {
                              const key = comboSelectionInputKey(selection);
                              const itemLabel = `Combo item ${index + 1}`;
                              const acceptedQuantity = getAcceptedComboQuantity(
                                group,
                                selection,
                              );
                              return (
                                <label
                                  className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-sm"
                                  key={key}
                                >
                                  <span className="min-w-0 break-words">
                                    {itemLabel}: {selection.productName} ·{" "}
                                    {selection.color} · {selection.sizeLabel}
                                  </span>
                                  <Input
                                    aria-label={`Received quantity for ${itemLabel}: ${selection.productName} ${selection.color} ${selection.sizeLabel}`}
                                    className="w-full"
                                    inputMode="numeric"
                                    max={group.quantity}
                                    min={0}
                                    onChange={(event) =>
                                      setComboAcceptedQuantities((current) => ({
                                        ...current,
                                        [group.id]: {
                                          ...current[group.id],
                                          [key]: event.target.value,
                                        },
                                      }))
                                    }
                                    type="number"
                                    value={
                                      comboAcceptedQuantities[group.id]?.[
                                        key
                                      ] ?? String(acceptedQuantity)
                                    }
                                  />
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(group.deliveryOutcome === "pending"
                              ? ([
                                  "complete",
                                  "incomplete",
                                  "declined",
                                ] as const)
                              : group.deliveryOutcome === "incomplete"
                                ? ([
                                    "incomplete",
                                    "redelivered_complete",
                                    "declined",
                                  ] as const)
                                : ([
                                    "redelivered_complete",
                                    "declined",
                                  ] as const)
                            ).map((outcome) => (
                              <Button
                                key={outcome}
                                disabled={
                                  pending ||
                                  (comboOutcomeReasons[group.id] ?? "").trim()
                                    .length < 3
                                }
                                onClick={() =>
                                  void recordComboOutcome(group.id, outcome)
                                }
                                type="button"
                                variant={
                                  outcome === "declined"
                                    ? "destructive"
                                    : "outline"
                                }
                              >
                                {pending
                                  ? "Saving…"
                                  : `Record ${humanize(outcome)}`}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                  </li>
                ))}
              </ul>
            </section>
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
          <p className="rounded-xl border border-border p-5 text-sm">
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
          <section className="rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
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
          <section className="rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
            <h2 className="text-xl font-semibold">Record delivery outcome</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Verify the delivery result before saving. This updates the Order
              record but does not mark COD as collected.
            </p>
            {order.comboGroups.length > 0 &&
              order.fulfillmentStatus === "dispatched" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Record the overall delivery outcome first, then record the
                  received quantities for each Combo.
                </p>
              )}
            {order.lines.some((line) => line.comboGroupId === null) && (
              <div className="mt-4 grid gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  Accepted quantities for regular items
                </p>
                <p className="text-xs text-muted-foreground">
                  Enter how many items the customer keeps. Use 0 for none.
                  Recording a full delivery accepts all ordered quantities.
                </p>
                {order.lines
                  .filter((line) => line.comboGroupId === null)
                  .map((line) => (
                    <label
                      className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-sm"
                      key={line.variantId}
                    >
                      <span className="min-w-0 break-words">
                        {line.productName} · {line.color} · {line.sizeLabel} ·{" "}
                        ordered {line.quantity}
                      </span>
                      <Input
                        aria-label={`Accepted quantity for ${line.productName} ${line.color} ${line.sizeLabel}`}
                        className="w-full"
                        inputMode="numeric"
                        max={line.quantity}
                        min={0}
                        onChange={(event) =>
                          setAcceptedItemQuantities((current) => ({
                            ...current,
                            [line.variantId]: event.target.value,
                          }))
                        }
                        step={1}
                        type="number"
                        value={
                          acceptedItemQuantities[line.variantId] ??
                          String(line.acceptedQuantity ?? 0)
                        }
                      />
                    </label>
                  ))}
              </div>
            )}
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
                  disabled={
                    pending ||
                    outcomeReason.trim().length < 3 ||
                    (outcome !== "delivered" && !acceptedItemQuantitiesAreValid)
                  }
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
        {hasUnresolvedComboOutcomes &&
          ["partially_delivered", "delivered", "returned"].includes(
            order.fulfillmentStatus,
          ) && (
            <p
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
              role="status"
            >
              Record a final delivery outcome for every Combo before reconciling
              COD.
            </p>
          )}
        {!hasUnresolvedComboOutcomes &&
          ["partially_delivered", "delivered", "returned"].includes(
            order.fulfillmentStatus,
          ) &&
          order.codAmountDueBdt > 0 && (
            <section className="rounded-2xl border border-border bg-card/70 p-5 sm:p-6">
              <h2 className="text-xl font-semibold">
                Reconcile COD collection
              </h2>
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
                  {humanize(order.collectionStatus)}:{" "}
                  {formatBdtPrice({
                    amountBdt: order.collectedAmountBdt!,
                  })}{" "}
                  / {formatBdtPrice({ amountBdt: order.codAmountDueBdt })}
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
