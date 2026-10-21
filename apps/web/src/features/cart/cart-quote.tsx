"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AuthoritativeQuote,
  type BangladeshGeography,
  type QuoteLookup,
} from "@aaraj/contracts";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  fetchBangladeshGeography,
  fetchCurrentQuote,
  lookupQuote,
  QuoteRequestError,
  requestQuote,
} from "./quote-client";
import type { Cart } from "@aaraj/contracts";

type LookupState = QuoteLookup["status"] | "unchecked";

const quoteLocationFormSchema = z.object({
  divisionId: z.string().min(1, "Choose a division."),
  districtId: z.string().min(1, "Choose a district."),
  upazilaId: z.string(),
});

type QuoteLocationFormValues = z.infer<typeof quoteLocationFormSchema>;

export function CartQuote({
  cart,
  mode = "cart",
  initialQuoteId = null,
  onCurrentQuoteChange,
  onQuotePendingChange,
}: {
  cart: Cart;
  mode?: "cart" | "checkout";
  initialQuoteId?: string | null;
  onCurrentQuoteChange?: (quote: AuthoritativeQuote | null) => void;
  onQuotePendingChange?: (pending: boolean) => void;
}) {
  const [bootstrapQuoteId] = useState(initialQuoteId);
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>("unchecked");
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [loadingInitialQuote, setLoadingInitialQuote] = useState(
    Boolean(bootstrapQuoteId),
  );
  const [quoting, setQuoting] = useState(false);
  const automaticQuoteAttemptKey = useRef<string | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [lastCheckedRefresh, setLastCheckedRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [upazilaRequiredForDistrict, setUpazilaRequiredForDistrict] = useState<
    string | null
  >(null);
  const {
    clearErrors,
    control,
    handleSubmit,
    register,
    setError: setFormError,
    setValue,
    formState: { errors: locationErrors, isSubmitting },
  } = useForm<QuoteLocationFormValues>({
    resolver: zodResolver(quoteLocationFormSchema),
    defaultValues: { divisionId: "", districtId: "", upazilaId: "" },
  });
  const divisionId = useWatch({ control, name: "divisionId" });
  const districtId = useWatch({ control, name: "districtId" });
  const upazilaId = useWatch({ control, name: "upazilaId" });
  const upazilaRequired =
    Boolean(districtId) && upazilaRequiredForDistrict === districtId;
  const divisionRegistration = register("divisionId");
  const districtRegistration = register("districtId");
  const upazilaRegistration = register("upazilaId");

  useEffect(() => {
    let active = true;
    void fetchBangladeshGeography()
      .then((data) => {
        if (!active) return;
        setGeography(data);
        if (bootstrapQuoteId) {
          void fetchCurrentQuote(bootstrapQuoteId)
            .then((initialQuote) => {
              if (!active) return;
              setQuote(initialQuote);
              setLookupState("current");
              setValue("divisionId", initialQuote.destination.divisionId);
              setValue("districtId", initialQuote.destination.districtId);
              setValue("upazilaId", initialQuote.destination.upazilaId ?? "");
              setStatusRefresh((value) => value + 1);
            })
            .catch((reason: unknown) => {
              if (active) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "The saved delivery total could not be verified. Choose your location again.",
                );
              }
            })
            .finally(() => {
              if (active) setLoadingInitialQuote(false);
            });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLookupState("unchecked");
          setLoadingInitialQuote(false);
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
  }, [bootstrapQuoteId, setValue]);

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
          setLookupState("unchecked");
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

  async function submitQuote(values: QuoteLocationFormValues) {
    if (!geography) return;
    if (upazilaRequired && !values.upazilaId) {
      setFormError("upazilaId", {
        type: "required",
        message: "Choose an upazila to calculate delivery for this district.",
      });
      return;
    }
    setQuoting(true);
    setError(null);
    try {
      const next = await requestQuote({
        geographyVersion: geography.datasetVersion,
        divisionId: values.divisionId,
        districtId: values.districtId,
        ...(values.upazilaId ? { upazilaId: values.upazilaId } : {}),
      });
      setQuote(next);
      setLookupState("current");
      if (!values.upazilaId) {
        setUpazilaRequiredForDistrict((requiredDistrictId) =>
          requiredDistrictId === values.districtId ? null : requiredDistrictId,
        );
      }
      setStatusRefresh((value) => value + 1);
    } catch (reason) {
      setLookupState("unchecked");
      handleQuoteFailure(
        reason,
        values.districtId,
        "The quote could not be created.",
      );
    } finally {
      setQuoting(false);
    }
  }

  const handleQuoteFailure = useCallback(
    (reason: unknown, forDistrictId: string, fallbackMessage: string) => {
      if (
        reason instanceof QuoteRequestError &&
        reason.errorCode === "DELIVERY_UPAZILA_REQUIRED"
      ) {
        setUpazilaRequiredForDistrict(forDistrictId);
        setFormError("upazilaId", {
          type: "required",
          message: "Choose an upazila to calculate delivery for this district.",
        });
        setQuote(null);
        setError(null);
        return;
      }
      setError(reason instanceof Error ? reason.message : fallbackMessage);
    },
    [setFormError],
  );

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
    Boolean(divisionId && districtId) &&
    (statusRefresh !== lastCheckedRefresh ||
      (cart.revision !== quote?.cartRevision && lookupState === "current") ||
      (destinationChanged &&
        lookupState !== "stale" &&
        lookupState !== "expired"));
  const isCurrent = Boolean(quote && quoteStatus === "current" && !checking);
  const currentQuote = isCurrent ? quote : null;
  const quotePending =
    loadingInitialQuote || quoting || (Boolean(quote) && checking);
  useEffect(() => {
    if (isCurrent) automaticQuoteAttemptKey.current = null;
  }, [isCurrent]);
  useEffect(() => {
    if (mode === "checkout") onCurrentQuoteChange?.(currentQuote);
  }, [currentQuote, mode, onCurrentQuoteChange]);
  useEffect(() => {
    if (mode === "checkout") onQuotePendingChange?.(quotePending);
  }, [mode, onQuotePendingChange, quotePending]);

  useEffect(() => {
    if (mode !== "checkout" || !geography || !divisionId || !districtId) {
      return;
    }
    const matchesCurrentQuote = Boolean(
      quote &&
      quote.cartRevision === cart.revision &&
      quote.destination.geographyVersion === geography.datasetVersion &&
      quote.destination.divisionId === divisionId &&
      quote.destination.districtId === districtId &&
      quote.destination.upazilaId === (upazilaId || null),
    );
    if (matchesCurrentQuote && lookupState === "current") return;
    const attemptKey = JSON.stringify([
      cart.revision,
      geography.datasetVersion,
      divisionId,
      districtId,
      upazilaId || "",
    ]);
    if (automaticQuoteAttemptKey.current === attemptKey) return;

    automaticQuoteAttemptKey.current = attemptKey;
    setQuoting(true);
    let active = true;
    void requestQuote({
      geographyVersion: geography.datasetVersion,
      divisionId,
      districtId,
      ...(upazilaId ? { upazilaId } : {}),
    })
      .then((next) => {
        if (!active) return;
        if (!upazilaId) {
          setUpazilaRequiredForDistrict((requiredDistrictId) =>
            requiredDistrictId === districtId ? null : requiredDistrictId,
          );
        }
        setError(null);
        setQuote(next);
        setLookupState("current");
        setStatusRefresh((value) => value + 1);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setLookupState("unchecked");
        handleQuoteFailure(
          reason,
          districtId,
          "The delivery total could not be calculated.",
        );
      })
      .finally(() => {
        if (active) setQuoting(false);
      });
    return () => {
      active = false;
    };
  }, [
    cart.revision,
    districtId,
    divisionId,
    geography,
    handleQuoteFailure,
    lookupState,
    mode,
    quote,
    upazilaId,
  ]);
  const hasUnavailableLines = cart.lines.some(
    (line) => line.availability === "unavailable",
  );

  const deliveryLocation = (
    <section
      aria-label={
        mode === "checkout" ? "Delivery location" : "Delivery and quote"
      }
      className={
        mode === "checkout"
          ? "min-w-0"
          : "mt-8 rounded-2xl border border-border p-5 sm:p-7"
      }
      id="delivery-and-order-total"
    >
      <h2 className="text-xl font-semibold">
        {mode === "checkout" ? "Delivery location" : "Delivery and order total"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "checkout"
          ? "Choose your delivery location. The delivery charge and total update automatically."
          : "Choose a Bangladesh delivery district. The server checks the destination and calculates the current price. Recipient and full delivery-address details will be collected during checkout."}
      </p>
      {hasUnavailableLines && (
        <p className="mt-4 text-sm text-destructive" role="status">
          Remove unavailable items from your cart before continuing.
        </p>
      )}
      {error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive" role="alert">
            {error}
          </p>
          {mode === "checkout" && divisionId && districtId && (
            <Button
              disabled={quoting || isSubmitting}
              onClick={() => {
                automaticQuoteAttemptKey.current = null;
                void handleSubmit(submitQuote)();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {loadingLocations || loadingInitialQuote ? (
        <p className="mt-5" role="status">
          Loading delivery locations…
        </p>
      ) : geography ? (
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={handleSubmit(submitQuote)}
        >
          <Field>
            <FieldLabel htmlFor="quote-division">Division</FieldLabel>
            <select
              id="quote-division"
              aria-invalid={Boolean(locationErrors.divisionId)}
              aria-describedby={
                locationErrors.divisionId ? "quote-division-error" : undefined
              }
              className="h-10 rounded-lg border border-input bg-background px-3"
              {...divisionRegistration}
              onChange={(event) => {
                void divisionRegistration.onChange(event);
                setValue("districtId", "");
                setValue("upazilaId", "");
                setUpazilaRequiredForDistrict(null);
                setQuote(null);
                setLookupState("unchecked");
                setQuoting(false);
                setError(null);
                automaticQuoteAttemptKey.current = null;
                clearErrors(["districtId", "upazilaId"]);
              }}
            >
              <option value="">Choose division</option>
              {divisions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {locationErrors.divisionId?.message && (
              <FieldError id="quote-division-error">
                {locationErrors.divisionId.message}
              </FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="quote-district">District</FieldLabel>
            <select
              id="quote-district"
              aria-invalid={Boolean(locationErrors.districtId)}
              aria-describedby={
                locationErrors.districtId ? "quote-district-error" : undefined
              }
              className="h-10 rounded-lg border border-input bg-background px-3"
              disabled={!divisionId}
              {...districtRegistration}
              onChange={(event) => {
                void districtRegistration.onChange(event);
                setValue("upazilaId", "");
                setUpazilaRequiredForDistrict(null);
                setQuote(null);
                setLookupState("unchecked");
                setQuoting(Boolean(divisionId && event.currentTarget.value));
                setError(null);
                automaticQuoteAttemptKey.current = null;
                clearErrors("upazilaId");
              }}
            >
              <option value="">Choose district</option>
              {districts.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {locationErrors.districtId?.message && (
              <FieldError id="quote-district-error">
                {locationErrors.districtId.message}
              </FieldError>
            )}
          </Field>
          {districtId && upazilas.length > 0 && (
            <Field>
              <FieldLabel htmlFor="quote-upazila">
                {upazilaRequired ? "Upazila *" : "Upazila (optional)"}
              </FieldLabel>
              <select
                id="quote-upazila"
                required={upazilaRequired}
                aria-invalid={
                  Boolean(locationErrors.upazilaId) ||
                  (upazilaRequired && !upazilaId)
                }
                aria-describedby={
                  [
                    upazilaRequired ? "quote-upazila-description" : null,
                    locationErrors.upazilaId ? "quote-upazila-error" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className="h-10 rounded-lg border border-input bg-background px-3"
                {...upazilaRegistration}
                onChange={(event) => {
                  void upazilaRegistration.onChange(event);
                  setQuote(null);
                  setLookupState("unchecked");
                  setQuoting(true);
                  setError(null);
                  clearErrors("upazilaId");
                  automaticQuoteAttemptKey.current = null;
                }}
              >
                <option value="">Choose upazila</option>
                {upazilas.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              {upazilaRequired && (
                <FieldDescription id="quote-upazila-description">
                  Choose an upazila to calculate delivery for this district.
                </FieldDescription>
              )}
              {locationErrors.upazilaId?.message && (
                <FieldError id="quote-upazila-error">
                  {locationErrors.upazilaId.message}
                </FieldError>
              )}
            </Field>
          )}
          {mode === "cart" && (
            <div className="sm:col-span-2">
              <Button
                disabled={isSubmitting || hasUnavailableLines}
                type="submit"
              >
                {isSubmitting
                  ? "Calculating…"
                  : quoteStatus === "stale" || quoteStatus === "expired"
                    ? "Request updated quote"
                    : "Get delivery quote"}
              </Button>
            </div>
          )}
        </form>
      ) : null}

      {quote && mode === "cart" && (
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
              <h3 className="font-semibold">Delivery quote</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {quote.destination.districtName}
                {quote.destination.upazilaName
                  ? ` · ${quote.destination.upazilaName}`
                  : ""}{" "}
                · valid until {formatDateTime(quote.expiresAt)}
              </p>
              <dl className="mt-4 grid gap-2 text-sm">
                <QuoteRow
                  label="Merchandise"
                  amount={quote.merchandiseGrossBdt}
                />
                <QuoteRow
                  label="Delivery"
                  amount={quote.delivery.grossAmountBdt}
                />
              </dl>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-base font-semibold">
                <span>Total</span>
                <span>{formatBdtPrice({ amountBdt: quote.totalBdt })}</span>
              </div>
              <Link
                className={buttonVariants({
                  className: "mt-5",
                  size: "lg",
                })}
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

  return deliveryLocation;
}

function QuoteRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatBdtPrice({ amountBdt: amount })}</dd>
    </div>
  );
}
