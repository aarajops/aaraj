"use client";

import { useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import {
  PATHAO_MINIMUM_ITEM_WEIGHT_KG,
  type Order,
  type PathaoBooking,
  type PathaoBookingManagement,
  type PathaoManualReconciliationInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPathaoBooking,
  PathaoClientError,
  reconcilePathaoBooking,
  submitPathaoBooking,
} from "./pathao-client";

export type PathaoAssignmentState =
  PathaoBooking["status"] | "none" | "loading" | "unavailable";

export function PathaoBookingPanel({
  order,
  onFulfillmentUpdated,
  onAssignmentStateChange,
  onRecordPickup,
  handoffPending,
  handoffError,
}: {
  order: Order;
  onFulfillmentUpdated?: () => void;
  onAssignmentStateChange?: (state: PathaoAssignmentState) => void;
  onRecordPickup?: (consignmentId: string) => Promise<void>;
  handoffPending?: boolean;
  handoffError?: string | null;
}) {
  const eligible =
    order.status === "confirmed" &&
    order.serviceability === "serviceable" &&
    order.fulfillmentStatus === "awaiting_dispatch";
  const [details, setDetails] = useState<PathaoBookingManagement | null>(null);
  const [consignmentId, setConsignmentId] = useState("");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [verifiedInPanel, setVerifiedInPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useRef<{ orderId: string; id: string } | null>(null);
  const reconciliationCommand = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const itemQuantity = order.lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const booking = details?.booking ?? null;
  const showPanel = Boolean(
    eligible ||
    order.dispatch?.deliveryProvider === "pathao" ||
    booking ||
    details?.claimStatus,
  );
  const canReconcile = [
    "submitting",
    "outcome_unknown",
    "reconciliation_required",
  ].some(
    (status) => booking?.status === status || details?.claimStatus === status,
  );

  function applyDetails(booking: PathaoBookingManagement) {
    setDetails(booking);
    onAssignmentStateChange?.(
      booking.claimStatus ?? booking.booking?.status ?? "none",
    );
  }

  async function refresh(): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      applyDetails(await getPathaoBooking(order.id));
      onFulfillmentUpdated?.();
      return true;
    } catch (reason) {
      onAssignmentStateChange?.("unavailable");
      setError(
        reason instanceof Error
          ? reason.message
          : "Pathao booking details could not be loaded.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void getPathaoBooking(order.id)
      .then((booking) => {
        if (!active) return;
        applyDetails(booking);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        onAssignmentStateChange?.("unavailable");
        setError(
          reason instanceof Error
            ? reason.message
            : "Pathao booking details could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Load saved booking state before enabling a new booking for this Order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  async function book() {
    let activeCommand = command.current;
    if (activeCommand?.orderId !== order.id) {
      activeCommand = { orderId: order.id, id: crypto.randomUUID() };
      command.current = activeCommand;
    }
    setPending(true);
    setError(null);
    try {
      const result = await submitPathaoBooking(order.id, activeCommand.id);
      setDetails({
        booking: result,
        claimStatus: result.status,
        observations: [],
      });
      onAssignmentStateChange?.(result.status);
      onFulfillmentUpdated?.();
    } catch (reason) {
      const message =
        reason instanceof PathaoClientError || reason instanceof Error
          ? reason.message
          : "Pathao booking could not be confirmed. Refresh before taking further action.";
      if (await refresh()) setError(message);
    } finally {
      setPending(false);
    }
  }

  async function reconcile() {
    if (!verifiedInPanel) return;
    const input: PathaoManualReconciliationInput = {
      consignmentId,
      reason: reconciliationReason,
      verifiedInPathaoPanel: true,
    };
    const fingerprint = JSON.stringify(input);
    let activeCommand = reconciliationCommand.current;
    if (activeCommand?.fingerprint !== fingerprint) {
      activeCommand = { fingerprint, id: crypto.randomUUID() };
      reconciliationCommand.current = activeCommand;
    }
    setPending(true);
    setError(null);
    try {
      const result = await reconcilePathaoBooking(
        order.id,
        input,
        activeCommand.id,
      );
      setDetails({
        booking: result,
        claimStatus: result.status,
        observations: [],
      });
      onAssignmentStateChange?.(result.status);
      onFulfillmentUpdated?.();
      setConsignmentId("");
      setReconciliationReason("");
      setVerifiedInPanel(false);
    } catch (reason) {
      const message =
        reason instanceof PathaoClientError || reason instanceof Error
          ? reason.message
          : "The Pathao consignment could not be reconciled. Refresh and review the provider record.";
      if (await refresh()) setError(message);
    } finally {
      setPending(false);
    }
  }

  if (!showPanel) return null;

  return (
    <section
      aria-label="Pathao courier booking"
      aria-busy={loading}
      className="grid gap-3 border-t border-border pt-4"
    >
      <h2 className="font-semibold">Pathao booking</h2>

      {error && (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          {(!details || details.claimStatus) && (
            <Button
              disabled={loading || pending}
              onClick={() => void refresh()}
              size="sm"
              variant="outline"
            >
              Refresh
            </Button>
          )}
        </div>
      )}
      {handoffError && (
        <p className="text-sm text-destructive" role="alert">
          {handoffError}
        </p>
      )}
      {loading && !details ? (
        <div aria-label="Loading Pathao booking details" role="status">
          <div aria-hidden="true" className="grid gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>
      ) : null}

      {booking ? (
        <div className="grid gap-1 text-sm">
          <p className="font-medium">{humanize(booking.status)}</p>
          <p className="text-muted-foreground">
            Tracking progress: {humanize(booking.trackingProgress)}
          </p>
          {booking.consignmentId && (
            <DataRow label="Pathao consignment" value={booking.consignmentId} />
          )}
          {booking.lastErrorCode && (
            <p className="text-destructive">
              Review code: {booking.lastErrorCode}
            </p>
          )}
          {booking.status === "outcome_unknown" && (
            <p className="text-destructive">
              Booking outcome is uncertain. Do not book again; verify the
              merchant reference in Pathao.
            </p>
          )}
          {booking.status === "reconciliation_required" && (
            <p className="text-destructive">
              Staff review is required before proceeding.
            </p>
          )}
          {booking.reconciliationReason && (
            <p className="text-muted-foreground">
              Staff reconciliation: {booking.reconciliationReason}
            </p>
          )}
          {eligible &&
            booking.status === "booked" &&
            booking.consignmentId &&
            onRecordPickup && (
              <div className="mt-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  Record pickup after Pathao collects the parcel.
                </p>
                <Button
                  disabled={pending || handoffPending}
                  onClick={() => void onRecordPickup(booking.consignmentId!)}
                >
                  {handoffPending
                    ? "Recording pickup…"
                    : "Record Pathao pickup"}
                </Button>
              </div>
            )}
        </div>
      ) : null}

      {!booking && details?.claimStatus && (
        <p className="mt-4 text-sm text-destructive" role="status">
          Pathao booking: {humanize(details.claimStatus)}. Resolve its outcome
          before taking another fulfillment action.
        </p>
      )}

      {eligible && details && !booking && !details.claimStatus && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            {itemQuantity} {itemQuantity === 1 ? "item" : "items"} ·{" "}
            {PATHAO_MINIMUM_ITEM_WEIGHT_KG} kg minimum
          </p>
          <Button disabled={pending} onClick={() => void book()}>
            <Truck aria-hidden="true" className="size-4" />
            {pending ? "Booking with Pathao…" : "Book order in Pathao"}
          </Button>
        </div>
      )}

      {eligible && canReconcile && (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-medium">
            Reconcile an existing Pathao consignment
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            Verify this consignment in the Pathao Merchant Panel before
            reconciling it here.
          </p>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium">
              Pathao consignment ID
              <Input
                autoComplete="off"
                maxLength={120}
                value={consignmentId}
                onChange={(event) => setConsignmentId(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Reconciliation reason
              <textarea
                className="min-h-24 rounded-md border border-input bg-background px-3 py-2"
                maxLength={500}
                value={reconciliationReason}
                onChange={(event) =>
                  setReconciliationReason(event.target.value)
                }
              />
              <span className="font-normal text-muted-foreground">
                Record the provider-panel verification. Do not include customer
                personal information.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                checked={verifiedInPanel}
                type="checkbox"
                onChange={(event) => setVerifiedInPanel(event.target.checked)}
              />
              I verified this consignment in the Pathao Merchant Panel.
            </label>
            <Button
              disabled={
                pending ||
                !consignmentId ||
                !reconciliationReason.trim() ||
                !verifiedInPanel
              }
              variant="outline"
              onClick={() => void reconcile()}
            >
              {pending ? "Verifying consignment…" : "Verify and reconcile"}
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-2 flex flex-wrap justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </p>
  );
}

function humanize(value: string): string {
  return value
    .split(/[_.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
