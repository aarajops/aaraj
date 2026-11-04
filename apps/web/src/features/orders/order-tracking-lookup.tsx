"use client";

import { useState, type SubmitEvent } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { PathaoCustomerTrackingLookup } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ShipmentStatusBadge } from "./order-status-badges";
import { humanizePathaoStatus } from "./orders-format";
import {
  lookupPathaoCustomerTracking,
  PathaoClientError,
} from "./pathao-client";
import { formatDateTime } from "@/lib/date-time";

type TrackingResult = {
  reference: string;
  tracking: PathaoCustomerTrackingLookup;
};

export function OrderTrackingLookup() {
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const formData = new FormData(event.currentTarget);
    const reference = String(formData.get("reference") ?? "");
    const phone = String(formData.get("phone") ?? "");

    setPending(true);
    setError(null);
    setResult(null);
    try {
      const tracking = await lookupPathaoCustomerTracking({
        reference,
        phone,
      });
      setResult({ reference: reference.trim().toUpperCase(), tracking });
    } catch (reason) {
      setError(
        reason instanceof PathaoClientError && reason.status === 404
          ? "We couldn't find an order matching those details. Check the order ID and checkout phone number."
          : "We couldn't load tracking right now. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const trackingProgress = result?.tracking.trackingProgress;
  const statusNeedsReview = trackingProgress === "reconciliation_required";

  return (
    <main className="flex-1 px-5 py-10 text-foreground sm:py-16">
      <div className="mx-auto grid w-full max-w-xl gap-6">
        <header className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Track your order
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Enter your order ID and checkout phone number to see the latest
            Pathao shipment update.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Order details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <Field>
                <FieldLabel htmlFor="tracking-reference">Order ID</FieldLabel>
                <Input
                  aria-describedby="tracking-reference-description"
                  autoCapitalize="characters"
                  autoComplete="off"
                  id="tracking-reference"
                  maxLength={16}
                  name="reference"
                  placeholder="ORD-026-00078"
                  required
                />
                <FieldDescription id="tracking-reference-description">
                  Find it in your order confirmation.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="tracking-phone">Phone number</FieldLabel>
                <Input
                  aria-describedby="tracking-phone-description"
                  autoComplete="tel"
                  id="tracking-phone"
                  inputMode="tel"
                  name="phone"
                  placeholder="01XXXXXXXXX"
                  required
                  type="tel"
                />
                <FieldDescription id="tracking-phone-description">
                  Use the same number you entered at checkout.
                </FieldDescription>
              </Field>

              <Button
                className="w-full"
                disabled={pending}
                size="lg"
                type="submit"
              >
                {pending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Search aria-hidden="true" />
                )}
                {pending ? "Checking order…" : "Track order"}
              </Button>
            </form>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card aria-label="Order tracking result" aria-live="polite">
            <CardHeader>
              <CardTitle>Order {result.reference}</CardTitle>
              {result.tracking.consignmentId && (
                <CardDescription>
                  Pathao consignment {result.tracking.consignmentId}
                </CardDescription>
              )}
            </CardHeader>
            {trackingProgress ? (
              <CardContent className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <span className="text-sm font-medium">
                    Current shipment status
                  </span>
                  <ShipmentStatusBadge
                    label={
                      statusNeedsReview
                        ? "Update unavailable"
                        : humanizePathaoStatus(trackingProgress)
                    }
                    status={
                      statusNeedsReview ? "unavailable" : trackingProgress
                    }
                  />
                </div>
                <section aria-labelledby="shipment-updates-heading">
                  <h2
                    className="text-sm font-semibold"
                    id="shipment-updates-heading"
                  >
                    Shipment history
                  </h2>
                  <ol className="mt-4">
                    {result.tracking.timeline.map((event, index) => {
                      const isLatest =
                        index === result.tracking.timeline.length - 1;

                      return (
                        <li
                          className="flex gap-3"
                          key={`${event.trackingProgress}-${event.updatedAt}`}
                        >
                          <span
                            aria-hidden="true"
                            className="relative flex w-4 shrink-0 justify-center"
                          >
                            {!isLatest && (
                              <span className="absolute top-4 bottom-0 w-px bg-border" />
                            )}
                            <span
                              className={`relative z-10 mt-1 size-2.5 rounded-full border ${isLatest ? "border-primary bg-primary" : "border-muted-foreground/50 bg-background"}`}
                            />
                          </span>
                          <div
                            className={`min-w-0 flex-1 ${isLatest ? "pb-0" : "pb-5"}`}
                          >
                            <p
                              aria-current={isLatest ? "step" : undefined}
                              className={`text-sm ${isLatest ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                            >
                              {humanizePathaoStatus(event.trackingProgress)}
                            </p>
                            <time
                              className="mt-1 block text-xs text-muted-foreground"
                              dateTime={event.updatedAt}
                            >
                              {formatDateTime(event.updatedAt)}
                            </time>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  Shipment tracking will appear here once a Pathao consignment
                  has been booked for this order.
                </p>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
