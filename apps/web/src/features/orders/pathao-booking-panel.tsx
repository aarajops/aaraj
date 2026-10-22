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
import { formatBdtPrice } from "@/lib/currency";
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
}: {
  order: Order;
  onAssignmentStateChange: (state: PathaoAssignmentState) => void;
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
    onAssignmentStateChange(
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
      onAssignmentStateChange("unavailable");
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
        onAssignmentStateChange("unavailable");
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
      onAssignmentStateChange(result.status);
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
      onAssignmentStateChange(result.status);
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
      className="mt-6 rounded-2xl border border-border p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Pathao courier booking</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Booking creates a courier consignment. It does not dispatch the
            parcel or consume reserved stock. Record physical handoff with the
            existing dispatch action.
          </p>
        </div>
        <Button
          disabled={loading || pending}
          variant="outline"
          onClick={() => void refresh()}
        >
          Refresh status
        </Button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading && !details ? (
        <p className="mt-4 text-sm" role="status">
          Loading courier booking…
        </p>
      ) : null}

      {booking ? (
        <div className="mt-5 rounded-xl border border-border p-4">
          <p className="font-medium">{humanize(booking.status)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tracking progress: {humanize(booking.trackingProgress)}
          </p>
          {booking.consignmentId && (
            <DataRow label="Pathao consignment" value={booking.consignmentId} />
          )}
          {booking.providerOrderStatus && (
            <DataRow
              label="Provider status"
              value={booking.providerOrderStatus}
            />
          )}
          {booking.lastErrorCode && (
            <p className="mt-2 text-sm text-destructive">
              Review code: {booking.lastErrorCode}
            </p>
          )}
          {booking.deliveryFeeBdt !== null && (
            <p className="mt-2 text-sm text-muted-foreground">
              Pathao reported delivery fee:{" "}
              {formatProviderFee(booking.deliveryFeeBdt)} BDT. This is a
              merchant cost observation; it does not change the customer&apos;s
              COD amount.
            </p>
          )}
          {booking.status === "outcome_unknown" && (
            <p className="mt-3 text-sm text-destructive">
              Pathao&apos;s outcome is uncertain. Do not submit another create
              request. Reconcile merchant reference {booking.merchantOrderId}
              against the Pathao merchant panel before proceeding.
            </p>
          )}
          {booking.status === "reconciliation_required" && (
            <p className="mt-3 text-sm text-destructive">
              This booking needs an authorized operations review before the
              consignment can be used.
            </p>
          )}
          {booking.reconciliationReason && (
            <p className="mt-3 text-sm text-muted-foreground">
              Staff reconciliation: {booking.reconciliationReason}
            </p>
          )}
        </div>
      ) : null}

      {!booking && details?.claimStatus && (
        <p className="mt-4 text-sm text-destructive" role="status">
          Pathao assignment: {humanize(details.claimStatus)}. Verify the
          consignment before dispatching.
        </p>
      )}

      {details?.observations.length ? (
        <div className="mt-5">
          <h3 className="font-semibold">Pathao observations</h3>
          <ul className="mt-2 divide-y divide-border text-sm">
            {details.observations.map((observation) => (
              <li
                className="py-3"
                key={observation.event + observation.receivedAt}
              >
                <p>
                  {observation.event} · {humanize(observation.status)}
                </p>
                {observation.providerStatus && (
                  <p className="text-muted-foreground">
                    Current verified provider status:{" "}
                    {observation.providerStatus}
                  </p>
                )}
                {observation.providerCollectedAmount !== null && (
                  <p className="text-muted-foreground">
                    Provider-reported collected amount:{" "}
                    {observation.providerCollectedAmount} (unit unverified).
                    Verify it against delivery records before recording COD
                    collection.
                  </p>
                )}
                {observation.status === "reconciliation_required" && (
                  <p className="text-destructive">
                    Needs staff review; no Order payment or Inventory change was
                    applied.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {eligible && !booking && !details?.claimStatus ? (
        options && options.stores.length > 0 ? (
          <div className="mt-5 grid gap-4">
            <p className="text-sm text-muted-foreground">
              Configured Pathao service:{" "}
              {deliveryTypeName(options.deliveryType)}.
            </p>
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
                Pathao documents a range of 0.5–10 kg. Enter the measured parcel
                weight; product units do not determine parcel count or weight.
              </span>
            </label>
            <p className="text-sm text-muted-foreground">
              Pathao will receive the Order&apos;s authoritative COD due of{" "}
              {formatBdtPrice({ amountBdt: order.codAmountDueBdt })}. The full
              address is sent without AARAJ geography IDs so Pathao can perform
              its documented address detection.
            </p>
            <Button
              disabled={
                pending || !parcelQuantity || !parcelWeightKg || !storeId
              }
              onClick={() => void book()}
            >
              {pending ? "Submitting booking…" : "Create Pathao booking"}
            </Button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            No active Pathao store was returned for this merchant account. Check
            the Pathao Merchant Panel store list.
          </p>
        )
      ) : null}

      {eligible && options && booking?.status !== "booked" && (
        <details className="mt-6 rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-medium">
            Reconcile an existing Pathao consignment
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            Use this only after checking the consignment in the Pathao Merchant
            Panel. AARAJ verifies the consignment with Pathao and records your
            reason. A webhook reference alone never links an Order.
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

function formatProviderFee(value: number): string {
  return new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function deliveryTypeName(value: 48 | 12): string {
  return value === 48 ? "Normal Delivery (48)" : "On Demand Delivery (12)";
}
