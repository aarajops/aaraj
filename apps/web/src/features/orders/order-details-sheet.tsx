"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import {
  MAX_CART_QUANTITY_PER_VARIANT,
  MAX_ORDER_LINES,
  type Order,
  type OrderManagementDetail,
  type OrderStatusUpdateInput,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { cn } from "cn";
import {
  CatalogVariantSearch,
  type CatalogVariantSelection,
} from "../catalog/catalog-variant-search";
import { OrderStatusMenu } from "./order-status-menu";
import {
  addOrderItem,
  fetchManagedOrder,
  updateOrderStatus,
} from "./orders-client";
import { humanize, humanizeOrderStatus } from "./orders-format";
import { PathaoBookingPanel } from "./pathao-booking-panel";

type OrderDetailsSheetProps = {
  onFulfillmentUpdated: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  orderId: string | null;
};

export function OrderDetailsSheet(props: OrderDetailsSheetProps) {
  return (
    <Sheet onOpenChange={props.onOpenChange} open={props.open}>
      <SheetContent className="gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <OrderDetailsSheetContent key={props.orderId ?? "closed"} {...props} />
      </SheetContent>
    </Sheet>
  );
}

function OrderDetailsSheetContent({
  onFulfillmentUpdated,
  onOpenChange,
  open,
  orderId,
}: OrderDetailsSheetProps) {
  const [details, setDetails] = useState<
    | { orderId: string; requestVersion: number; status: "error" }
    | {
        orderId: string;
        requestVersion: number;
        status: "success";
        order: OrderManagementDetail;
      }
    | null
  >(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<{
    orderId: string;
    message: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelFormOpen, setCancelFormOpen] = useState(false);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [itemPending, setItemPending] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [catalogSelection, setCatalogSelection] =
    useState<CatalogVariantSelection | null>(null);
  const [itemQuantity, setItemQuantity] = useState("1");
  const currentDetails =
    details?.orderId === orderId && details.requestVersion === requestVersion
      ? details
      : null;
  const order =
    currentDetails?.status === "success" ? currentDetails.order : null;
  const loading = open && orderId !== null && currentDetails === null;
  const error = currentDetails?.status === "error";
  const availableStatusActions = order?.availableStatusActions ?? [];
  const canCancelOrder = availableStatusActions.includes("cancelled");

  async function updateStatus(input: OrderStatusUpdateInput) {
    if (!order || statusPending || itemPending) return;
    setStatusPending(true);
    setStatusError(null);
    try {
      const updatedOrder = await updateOrderStatus(order.id, input);
      setDetails((current) =>
        current?.status === "success" && current.orderId === updatedOrder.id
          ? { ...current, order: updatedOrder }
          : current,
      );
      setCancelFormOpen(false);
      setCancelReason("");
      onFulfillmentUpdated();
    } catch (reason) {
      setStatusError({
        orderId: order.id,
        message:
          reason instanceof Error
            ? reason.message
            : "The order status could not be updated.",
      });
    } finally {
      setStatusPending(false);
    }
  }

  async function addItem() {
    if (!order || !catalogSelection || statusPending || itemPending) return;
    const quantity = Number(itemQuantity);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity + catalogSelection.currentQuantity >
        MAX_CART_QUANTITY_PER_VARIANT
    ) {
      return;
    }

    setItemPending(true);
    setItemError(null);
    try {
      const updatedOrder = await addOrderItem(order.id, {
        variantId: catalogSelection.variantId,
        quantity,
        expectedCurrentQuantity: catalogSelection.currentQuantity,
        expectedUnitPriceBdt: catalogSelection.unitPriceBdt,
      });
      setDetails((current) =>
        current?.status === "success" && current.orderId === updatedOrder.id
          ? { ...current, order: updatedOrder }
          : current,
      );
      setItemEditorOpen(false);
      setCatalogSelection(null);
      setItemQuantity("1");
      onFulfillmentUpdated();
    } catch (reason) {
      setItemError(
        reason instanceof Error
          ? reason.message
          : "The item could not be added to this order.",
      );
    } finally {
      setItemPending(false);
    }
  }

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
    <div
      aria-busy={loading}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <SheetHeader className="border-b border-border pr-12">
        {loading ? (
          <>
            <SheetTitle className="sr-only">Loading order details</SheetTitle>
            <div aria-hidden="true" className="grid gap-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-52" />
            </div>
          </>
        ) : (
          <>
            <SheetTitle>
              {order ? `Order ${order.reference}` : "Order details"}
            </SheetTitle>
            <SheetDescription>
              {order
                ? `Placed ${formatDateTime(order.createdAt)}`
                : "Customer, delivery, items, and payment summary."}
            </SheetDescription>
          </>
        )}
      </SheetHeader>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading && <OrderDetailsSkeleton />}

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
          <div className="grid min-w-0 gap-5">
            <section aria-label="Order status" className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={orderStatusVariant(order.status)}>
                    {humanizeOrderStatus(order.status)}
                  </Badge>
                  <Badge variant="secondary">
                    {humanize(order.fulfillmentStatus)}
                  </Badge>
                </div>
                <OrderStatusMenu
                  actions={availableStatusActions}
                  disabled={statusPending || itemPending || itemEditorOpen}
                  onSelect={(action) => {
                    if (action === "cancelled") {
                      setStatusError(null);
                      setCancelReason("");
                      setCancelFormOpen(true);
                    } else {
                      void updateStatus({ status: action });
                    }
                  }}
                />
              </div>
              {cancelFormOpen && canCancelOrder && (
                <form
                  className="grid gap-3 rounded-lg border border-border p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateStatus({
                      status: "cancelled",
                      reason: cancelReason.trim(),
                    });
                  }}
                >
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
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={statusPending}
                      onClick={() => setCancelFormOpen(false)}
                      type="button"
                      variant="outline"
                    >
                      Keep order
                    </Button>
                    <Button
                      disabled={statusPending || cancelReason.trim().length < 3}
                      type="submit"
                      variant="destructive"
                    >
                      {statusPending ? "Cancelling…" : "Cancel order"}
                    </Button>
                  </div>
                </form>
              )}
              {statusError?.orderId === order.id && (
                <p className="text-sm text-destructive" role="alert">
                  {statusError.message}
                </p>
              )}
              <dl className="divide-y divide-border text-sm">
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
              className="grid min-w-0 gap-2 border-t border-border pt-4"
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
              className="grid min-w-0 gap-2 border-t border-border pt-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold" id="order-items-heading">
                  Items ({order.lines.length})
                </h3>
                {order.canAddItems && !itemEditorOpen && !cancelFormOpen && (
                  <Button
                    disabled={statusPending || itemPending}
                    onClick={() => {
                      setItemError(null);
                      setItemEditorOpen(true);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus aria-hidden="true" />
                    Add item
                  </Button>
                )}
              </div>
              <ul className="min-w-0 divide-y divide-border border-y border-border">
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
              {itemEditorOpen && order.canAddItems && (
                <div className="grid min-w-0 gap-3 rounded-lg border border-border p-3">
                  <CatalogVariantSearch
                    disabled={itemPending}
                    existingVariants={order.lines.map(
                      ({ variantId, quantity, unitPriceBdt }) => ({
                        variantId,
                        quantity,
                        unitPriceBdt,
                      }),
                    )}
                    lineLimitReached={order.lines.length >= MAX_ORDER_LINES}
                    onSelect={(selection) => {
                      setCatalogSelection(selection);
                      setItemQuantity("1");
                    }}
                  />
                  {catalogSelection && (
                    <>
                      <label className="grid gap-2 text-sm font-medium">
                        {catalogSelection.currentQuantity > 0
                          ? "Additional quantity"
                          : "Quantity"}
                        <Input
                          disabled={itemPending}
                          max={
                            MAX_CART_QUANTITY_PER_VARIANT -
                            catalogSelection.currentQuantity
                          }
                          min={1}
                          onChange={(event) =>
                            setItemQuantity(event.target.value)
                          }
                          type="number"
                          value={itemQuantity}
                        />
                      </label>
                      {catalogSelection.currentQuantity > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Current quantity is {catalogSelection.currentQuantity}
                          . Added units use the order’s saved unit price.
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Estimated COD due:{" "}
                        {formatBdtPrice({
                          amountBdt:
                            order.codAmountDueBdt +
                            catalogSelection.unitPriceBdt *
                              (Number(itemQuantity) || 0),
                        })}
                      </p>
                    </>
                  )}
                  {itemError && (
                    <p className="text-sm text-destructive" role="alert">
                      {itemError}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      disabled={itemPending}
                      onClick={() => {
                        setItemEditorOpen(false);
                        setCatalogSelection(null);
                        setItemQuantity("1");
                        setItemError(null);
                      }}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={
                        !catalogSelection ||
                        !Number.isInteger(Number(itemQuantity)) ||
                        Number(itemQuantity) < 1 ||
                        Number(itemQuantity) +
                          (catalogSelection?.currentQuantity ?? 0) >
                          MAX_CART_QUANTITY_PER_VARIANT ||
                        itemPending ||
                        statusPending
                      }
                      onClick={() => void addItem()}
                      type="button"
                    >
                      {itemPending
                        ? "Adding…"
                        : catalogSelection?.currentQuantity
                          ? "Add quantity"
                          : "Add to order"}
                    </Button>
                  </div>
                </div>
              )}
              {!order.canAddItems &&
                order.status === "confirmed" &&
                order.fulfillmentStatus === "awaiting_dispatch" &&
                order.collectionStatus === "uncollected" &&
                order.collectedAmountBdt === null && (
                  <p className="text-sm text-muted-foreground">
                    This order has a Pathao consignment. Its items and COD
                    amount are locked after booking.
                  </p>
                )}
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

            <PathaoBookingPanel
              onFulfillmentUpdated={onFulfillmentUpdated}
              order={order}
            />
          </div>
        )}
      </div>

      {loading && (
        <SheetFooter aria-hidden="true" className="border-t border-border">
          <Skeleton className="h-9 w-full rounded-lg" />
        </SheetFooter>
      )}

      {order && (
        <SheetFooter className="border-t border-border">
          <Link
            className="inline-flex items-center justify-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground"
            href={`/admin/orders/${order.id}`}
            onClick={() => onOpenChange(false)}
          >
            <FileText aria-hidden="true" className="size-4" />
            Open full order review
          </Link>
        </SheetFooter>
      )}
    </div>
  );
}

function OrderDetailsSkeleton() {
  return (
    <div aria-label="Loading order details" role="status">
      <div aria-hidden="true" className="grid gap-5">
        <section className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </section>

        <section className="grid gap-2 border-t border-border pt-4">
          <Skeleton className="h-5 w-20" />
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
          </div>
        </section>

        <section className="grid gap-2 border-t border-border pt-4">
          <Skeleton className="h-5 w-28" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </section>

        <section className="grid gap-2 border-t border-border pt-4">
          <Skeleton className="h-5 w-20" />
          <ul className="divide-y divide-border border-y border-border">
            {[0, 1].map((item) => (
              <li className="flex justify-between gap-4 py-3" key={item}>
                <div className="grid min-w-0 flex-1 gap-2">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-2/5" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0" />
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-3 border-t border-border pt-4">
          {[0, 1, 2].map((row) => (
            <div className="flex justify-between gap-4" key={row}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
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
  if (status === "cancelled") return "destructive";
  if (status === "confirmed") return "default";
  return "secondary";
}
