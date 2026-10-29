"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Order,
  PathaoBooking,
  PathaoBookingManagement,
  PathaoBookingOptions,
  PathaoBookingInput,
  PathaoManualReconciliationInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getPathaoBooking,
  getPathaoBookingOptions,
  PathaoClientError,
  reconcilePathaoBooking,
  submitPathaoBooking,
} from "./pathao-client";

export type PathaoAssignmentState =
  PathaoBooking["status"] | "none" | "loading" | "unavailable";

export function PathaoBookingPanel({
  order,
  onAssignmentStateChange,
  onRecordPickup,
  handoffPending,
  handoffError,
}: {
  order: Order;
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
  const [options, setOptions] = useState<PathaoBookingOptions | null>(null);
  const [storeId, setStoreId] = useState("");
  const [parcelQuantity, setParcelQuantity] = useState("");
  const [parcelWeightKg, setParcelWeightKg] = useState("");
  const [consignmentId, setConsignmentId] = useState("");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [verifiedInPanel, setVerifiedInPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const reconciliationCommand = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);

  async function loadDetails() {
    const booking = await getPathaoBooking(order.id);
    let bookingOptions: PathaoBookingOptions | null = null;
    let optionsError: string | null = null;
    if (eligible) {
      try {
        bookingOptions = await getPathaoBookingOptions();
      } catch (reason) {
        optionsError =
          reason instanceof Error
            ? reason.message
            : "Pathao booking options could not be loaded.";
      }
    }
    return { booking, bookingOptions, optionsError };
  }

  function applyDetails(
    booking: PathaoBookingManagement,
    bookingOptions: PathaoBookingOptions | null,
    optionsError: string | null,
  ) {
    setDetails(booking);
    setOptions(bookingOptions);
    onAssignmentStateChange?.(
      booking.claimStatus ?? booking.booking?.status ?? "none",
    );
    setError(optionsError);
    if (booking.booking) {
      setStoreId((value) => value || String(booking.booking!.storeId));
      setParcelQuantity(
        (value) => value || String(booking.booking!.parcelQuantity),
      );
      setParcelWeightKg(
        (value) => value || String(booking.booking!.parcelWeightKg),
      );
    }
    if (bookingOptions?.stores[0]) {
      setStoreId((value) => value || String(bookingOptions.stores[0]!.storeId));
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { booking, bookingOptions, optionsError } = await loadDetails();
      applyDetails(booking, bookingOptions, optionsError);
    } catch (reason) {
      onAssignmentStateChange?.("unavailable");
      setError(
        reason instanceof Error
          ? reason.message
          : "Pathao booking details could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void loadDetails()
      .then(({ booking, bookingOptions, optionsError }) => {
        if (!active) return;
        applyDetails(booking, bookingOptions, optionsError);
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
    // Load the provider state for the reviewed Order and eligibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, eligible]);

  async function book() {
    if (!options || !storeId) return;
    const input: PathaoBookingInput = {
      storeId: Number(storeId),
      parcelQuantity: Number(parcelQuantity),
      parcelWeightKg: Number(parcelWeightKg),
    };
    const fingerprint = JSON.stringify(input);
    let activeCommand = command.current;
    if (activeCommand?.fingerprint !== fingerprint) {
      activeCommand = { fingerprint, id: crypto.randomUUID() };
      command.current = activeCommand;
    }
    setPending(true);
    setError(null);
    try {
      const result = await submitPathaoBooking(
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
    } catch (reason) {
      const message =
        reason instanceof PathaoClientError || reason instanceof Error
          ? reason.message
          : "Pathao booking could not be confirmed. Refresh before taking further action.";
      await refresh();
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function reconcile() {
    if (!options || !storeId || !verifiedInPanel) return;
    const input: PathaoManualReconciliationInput = {
      consignmentId,
      storeId: Number(storeId),
      parcelQuantity: Number(parcelQuantity),
      parcelWeightKg: Number(parcelWeightKg),
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
      setConsignmentId("");
      setReconciliationReason("");
      setVerifiedInPanel(false);
    } catch (reason) {
      const message =
        reason instanceof PathaoClientError || reason instanceof Error
          ? reason.message
          : "The Pathao consignment could not be reconciled. Refresh and review the provider record.";
      await refresh();
      setError(message);
    } finally {
      setPending(false);
    }
  }

  const booking = details?.booking ?? null;
  if (!eligible && !booking) return null;

  return (
    <section
      aria-label="Pathao courier booking"
      className="grid gap-3 border-t border-border pt-4"
    >
      <h2 className="font-semibold">Pathao booking</h2>

      {error && (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            disabled={loading || pending}
            onClick={() => void refresh()}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      )}
      {handoffError && (
        <p className="text-sm text-destructive" role="alert">
          {handoffError}
        </p>
      )}
      {loading && !details ? (
        <p
          aria-busy="true"
          className="text-sm text-muted-foreground"
          role="status"
        >
          Loading booking…
        </p>
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

      {eligible && !booking && !details?.claimStatus && options ? (
        options.stores.length > 0 ? (
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              Active Pathao store
              <select
                className="h-10 rounded-md border border-input bg-background px-3"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
              >
                {options.stores.map((store) => (
                  <option key={store.storeId} value={store.storeId}>
                    {store.storeName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Actual parcel count
              <Input
                min={1}
                step={1}
                type="number"
                value={parcelQuantity}
                onChange={(event) => setParcelQuantity(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Actual parcel weight (kg)
              <Input
                min={0.5}
                max={10}
                step="any"
                type="number"
                value={parcelWeightKg}
                onChange={(event) => setParcelWeightKg(event.target.value)}
              />
              <span className="font-normal text-muted-foreground">
                0.5–10 kg. Enter the measured weight.
              </span>
            </label>
            <Button
              disabled={
                pending || !parcelQuantity || !parcelWeightKg || !storeId
              }
              onClick={() => void book()}
            >
              {pending ? "Booking with Pathao…" : "Book order in Pathao"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No active Pathao store.
          </p>
        )
      ) : null}

      {eligible &&
        options &&
        (booking?.status === "outcome_unknown" ||
          booking?.status === "reconciliation_required" ||
          details?.claimStatus) && (
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
                Actual parcel count
                <Input
                  min={1}
                  step={1}
                  type="number"
                  value={parcelQuantity}
                  onChange={(event) => setParcelQuantity(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Actual parcel weight (kg)
                <Input
                  min={0.5}
                  max={10}
                  step="any"
                  type="number"
                  value={parcelWeightKg}
                  onChange={(event) => setParcelWeightKg(event.target.value)}
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
                  Record the provider-panel verification. Do not include
                  customer personal information.
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
                  !parcelQuantity ||
                  !parcelWeightKg ||
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
