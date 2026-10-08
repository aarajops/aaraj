"use client";

import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import {
  type AuthoritativeQuote,
  type BangladeshGeography,
  type QuoteLookup,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { formatCatalogPrice } from "@/features/catalog/price";
import {
  fetchBangladeshGeography,
  lookupQuote,
  requestQuote,
} from "./quote-client";
import type { Cart } from "@aaraj/contracts";

type LookupState = QuoteLookup["status"] | "unchecked";

export function CartQuote({ cart }: { cart: Cart }) {
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [divisionId, setDivisionId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [upazilaId, setUpazilaId] = useState("");
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>("unchecked");
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [lastCheckedRefresh, setLastCheckedRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBangladeshGeography()
      .then((data) => {
        if (active) setGeography(data);
      })
      .catch((reason: unknown) => {
        if (active) {
          setLookupState("unchecked");
          setError(
            reason instanceof Error
              ? reason.message
              : "Bangladesh delivery locations could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingLocations(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const divisions = useMemo(
    () =>
      geography?.locations.filter(
        (location) => location.level === "division",
      ) ?? [],
    [geography],
  );
  const districts = useMemo(
    () =>
      geography?.locations.filter(
        (location) =>
          location.level === "district" && location.parentId === divisionId,
      ) ?? [],
    [geography, divisionId],
  );
  const upazilas = useMemo(
    () =>
      geography?.locations.filter(
        (location) =>
          location.level === "upazila" && location.parentId === districtId,
      ) ?? [],
    [geography, districtId],
  );

  useEffect(() => {
    if (!quote || !geography || !divisionId || !districtId) return;
    let active = true;
    void lookupQuote(quote.id, {
      geographyVersion: geography.datasetVersion,
      divisionId,
      districtId,
      ...(upazilaId ? { upazilaId } : {}),
    })
      .then((result) => {
        if (!active) return;
        setLookupState(result.status);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "The quote status could not be checked.",
          );
        }
      })
      .finally(() => {
        if (active) setLastCheckedRefresh(statusRefresh);
      });
    return () => {
      active = false;
    };
  }, [
    cart.revision,
    quote,
    statusRefresh,
    geography,
    divisionId,
    districtId,
    upazilaId,
  ]);

  useEffect(() => {
    if (!quote) return;
    const refreshStatus = () => setStatusRefresh((value) => value + 1);
    const timeout = window.setTimeout(
      refreshStatus,
      Math.max(0, Date.parse(quote.expiresAt) - Date.now() + 1_000),
    );
    window.addEventListener("focus", refreshStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refreshStatus);
    };
  }, [quote]);

  async function submitQuote(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!geography || !divisionId || !districtId) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await requestQuote({
        geographyVersion: geography.datasetVersion,
        divisionId,
        districtId,
        ...(upazilaId ? { upazilaId } : {}),
      });
      setQuote(next);
      setLookupState("current");
      setStatusRefresh((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The quote could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const destinationChanged = Boolean(
    quote &&
    (!geography ||
      geography.datasetVersion !== quote.destination.geographyVersion ||
      divisionId !== quote.destination.divisionId ||
      districtId !== quote.destination.districtId ||
      (upazilaId || null) !== quote.destination.upazilaId),
  );
  const quoteStatus =
    quote && (cart.revision !== quote.cartRevision || destinationChanged)
      ? "stale"
      : lookupState;
  const checking =
    Boolean(quote) &&
    (statusRefresh !== lastCheckedRefresh ||
      (cart.revision !== quote?.cartRevision && lookupState === "current") ||
      (destinationChanged &&
        lookupState !== "stale" &&
        lookupState !== "expired"));

  return (
    <section
      aria-label="Delivery and quote"
      className="mt-8 rounded-2xl border border-border p-5 sm:p-7"
    >
      <h2 className="text-xl font-semibold">Delivery and order total</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose a Bangladesh delivery district. The server checks the destination
        and calculates the current price. Recipient and full delivery-address
        details will be collected during checkout.
      </p>
      {error && (
        <p
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {loadingLocations ? (
        <p className="mt-5" role="status">
          Loading delivery locations…
        </p>
      ) : geography ? (
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submitQuote(event)}
        >
          <label className="grid gap-2 text-sm font-medium">
            Division
            <select
              className="h-10 rounded-lg border border-input bg-background px-3"
              required
              value={divisionId}
              onChange={(event) => {
                setDivisionId(event.currentTarget.value);
                setDistrictId("");
                setUpazilaId("");
              }}
            >
              <option value="">Choose division</option>
              {divisions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            District
            <select
              className="h-10 rounded-lg border border-input bg-background px-3"
              required
              disabled={!divisionId}
              value={districtId}
              onChange={(event) => {
                setDistrictId(event.currentTarget.value);
                setUpazilaId("");
              }}
            >
              <option value="">Choose district</option>
              {districts.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Upazila (optional)
            <select
              className="h-10 rounded-lg border border-input bg-background px-3"
              disabled={!districtId || upazilas.length === 0}
              value={upazilaId}
              onChange={(event) => setUpazilaId(event.currentTarget.value)}
            >
              <option value="">Choose upazila</option>
              {upazilas.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <Button
              disabled={submitting || !divisionId || !districtId}
              type="submit"
            >
              {submitting
                ? "Calculating…"
                : quoteStatus === "stale" || quoteStatus === "expired"
                  ? "Request updated quote"
                  : "Get delivery quote"}
            </Button>
          </div>
        </form>
      ) : null}

      {quote && (
        <div
          aria-live="polite"
          className="mt-7 rounded-xl border border-border p-4"
        >
          {quoteStatus === "stale" ? (
            <p className="text-sm text-destructive" role="status">
              This quote is no longer current. Request an updated quote before
              continuing.
            </p>
          ) : quoteStatus === "expired" ? (
            <p className="text-sm text-destructive" role="status">
              This quote has expired. Request an updated quote before
              continuing.
            </p>
          ) : quoteStatus === "unchecked" ? (
            <p className="text-sm text-destructive" role="status">
              Quote status could not be verified. Request a new quote before
              continuing.
            </p>
          ) : checking ? (
            <p className="text-sm text-muted-foreground" role="status">
              Checking quote status…
            </p>
          ) : (
            <>
              <h3 className="font-semibold">Current quote</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {quote.destination.districtName}
                {quote.destination.upazilaName
                  ? ` · ${quote.destination.upazilaName}`
                  : ""}{" "}
                · valid until {formatDhakaTime(quote.expiresAt)}
              </p>
              <dl className="mt-4 grid gap-2 text-sm">
                <QuoteRow
                  label="Merchandise (tax-inclusive)"
                  amount={quote.merchandiseGrossBdt}
                />
                <QuoteRow
                  label={`Delivery · ${quote.delivery.tariffVersion}`}
                  amount={quote.delivery.grossAmountBdt}
                />
                <QuoteRow
                  label="Tax included in merchandise price"
                  amount={quote.tax.merchandise.taxAmountBdt}
                />
                {quote.delivery.tax.treatment === "taxable" && (
                  <QuoteRow
                    label="Tax included in delivery"
                    amount={quote.delivery.tax.taxAmountBdt}
                  />
                )}
              </dl>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-base font-semibold">
                <span>Total</span>
                <span>{formatCatalogPrice({ amountBdt: quote.totalBdt })}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Tax amounts are accounted within the displayed tax-inclusive
                prices. This quote is not an order and does not reserve stock.
              </p>
              <Link
                className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                href={`/checkout?quote=${encodeURIComponent(quote.id)}`}
              >
                Continue to checkout
              </Link>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function QuoteRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatCatalogPrice({ amountBdt: amount })}</dd>
    </div>
  );
}

function formatDhakaTime(value: string): string {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}
