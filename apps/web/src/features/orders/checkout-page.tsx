"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type AuthoritativeQuote,
  type BangladeshGeography,
  type CreateOrderInput,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCatalogPrice } from "@/features/catalog/price";
import {
  fetchBangladeshGeography,
  fetchCurrentQuote,
} from "@/features/cart/quote-client";
import {
  createCodOrder,
  OrderRequestError,
  resumeCodOrder,
} from "./orders-client";

type FormValues = {
  recipientName: string;
  phone: string;
  locality: string;
  doorstepDetails: string;
  street: string;
  house: string;
  postalCode: string;
  instructions: string;
};

const initialForm: FormValues = {
  recipientName: "",
  phone: "",
  locality: "",
  doorstepDetails: "",
  street: "",
  house: "",
  postalCode: "",
  instructions: "",
};

export function CheckoutPage({ quoteId }: { quoteId: string | null }) {
  const router = useRouter();
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);

  useEffect(() => {
    if (!quoteId) return;
    let active = true;
    const storageKey = `aaraj.checkout.idempotency:${quoteId}`;
    let key: string;
    try {
      const storedKey = window.sessionStorage.getItem(storageKey);
      key =
        storedKey && /^[0-9a-f-]{36}$/i.test(storedKey)
          ? storedKey
          : crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, key);
    } catch {
      key = crypto.randomUUID();
    }
    requestKey.current = key;

    void resumeCodOrder(key)
      .then((order) => {
        if (active) router.replace(`/orders/${order.id}`);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (
          reason instanceof OrderRequestError &&
          !["CHECKOUT_NOT_FOUND", "ORDER_NOT_FOUND"].includes(
            reason.errorCode ?? "",
          )
        ) {
          setError(reason.message);
          setLoading(false);
          return;
        }
        void Promise.all([
          fetchCurrentQuote(quoteId),
          fetchBangladeshGeography(),
        ])
          .then(([currentQuote, currentGeography]) => {
            if (!active) return;
            setQuote(currentQuote);
            setGeography(currentGeography);
          })
          .catch((quoteError: unknown) => {
            if (active) {
              setError(
                quoteError instanceof Error
                  ? quoteError.message
                  : "The quote could not be verified. Return to your cart for an updated quote.",
              );
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      });
    return () => {
      active = false;
    };
  }, [quoteId, router]);

  const division = geography?.locations.find(
    ({ id }) => id === quote?.destination.divisionId,
  );
  const district = geography?.locations.find(
    ({ id }) => id === quote?.destination.districtId,
  );
  const upazila = quote?.destination.upazilaId
    ? geography?.locations.find(({ id }) => id === quote.destination.upazilaId)
    : undefined;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const idempotencyKey = requestKey.current;
    if (!quote || !division || !district || !idempotencyKey || submitting)
      return;
    setError(null);
    const input: CreateOrderInput = {
      quoteId: quote.id,
      address: {
        ...form,
        geographyVersion: quote.destination.geographyVersion,
        divisionId: division.id,
        districtId: district.id,
        ...(upazila ? { upazilaId: upazila.id } : {}),
      },
    };
    setSubmitting(true);
    try {
      const order = await createCodOrder(input, idempotencyKey);
      router.push(`/orders/${order.id}`);
    } catch (reason) {
      if (
        reason instanceof OrderRequestError &&
        ["IDEMPOTENCY_KEY_REUSED", "ORDER_CHECKOUT_CONFLICT"].includes(
          reason.errorCode ?? "",
        )
      ) {
        try {
          const existing = await resumeCodOrder(idempotencyKey);
          router.push(`/orders/${existing.id}`);
          return;
        } catch (resumeError) {
          if (
            resumeError instanceof OrderRequestError &&
            resumeError.errorCode === "ORDER_ACCESS_UNAVAILABLE"
          ) {
            setError(resumeError.message);
            return;
          }
        }
      }
      setError(
        reason instanceof OrderRequestError || reason instanceof Error
          ? reason.message
          : "The Order could not be placed. Retry with the same details.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-background px-5 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link
          className="text-sm text-primary hover:text-primary/80"
          href="/cart"
        >
          ← Back to cart
        </Link>
        <p className="mt-8 text-sm font-semibold tracking-[0.16em] text-primary">
          AARAJ CHECKOUT
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Place your order
        </h1>

        {loading ? (
          <p className="mt-8" role="status">
            Checking your quote…
          </p>
        ) : !quote || !division || !district ? (
          <section className="mt-7 rounded-2xl border border-border p-6">
            <p role="alert">
              {error ?? "A current quote is required before checkout."}
            </p>
            <Link
              className="mt-4 inline-block text-primary underline"
              href="/cart"
            >
              Return to cart and request a quote
            </Link>
          </section>
        ) : (
          <>
            <section
              className="mt-6 rounded-2xl border border-border p-5 sm:p-7"
              aria-label="Order summary"
            >
              <h2 className="text-xl font-semibold">Order summary</h2>
              <ul className="mt-4 divide-y divide-border">
                {quote.lines.map((line) => (
                  <li
                    className="flex justify-between gap-4 py-3"
                    key={line.variantId}
                  >
                    <span>
                      <span className="block font-medium">
                        {line.productName}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {line.color} · {line.sizeLabel} · {line.quantity} ×{" "}
                        {formatCatalogPrice({ amountBdt: line.unitPriceBdt })}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">
                      {formatCatalogPrice({ amountBdt: line.grossAmountBdt })}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
                <MoneyRow
                  label="Merchandise subtotal"
                  amount={quote.merchandiseGrossBdt}
                />
                <MoneyRow
                  label="Tax included in merchandise"
                  amount={quote.tax.merchandise.taxAmountBdt}
                />
                {quote.delivery.tax.taxAmountBdt > 0 && (
                  <MoneyRow
                    label="Tax included in delivery"
                    amount={quote.delivery.tax.taxAmountBdt}
                  />
                )}
                <MoneyRow
                  label="Delivery charge"
                  amount={quote.delivery.grossAmountBdt}
                />
              </dl>
              <div className="mt-4 flex justify-between border-t border-border pt-4 text-lg font-semibold">
                <span>Total · COD due on delivery</span>
                <span>{formatCatalogPrice({ amountBdt: quote.totalBdt })}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Payment method: Cash on Delivery. No payment is collected now.
                AARAJ will manually verify delivery serviceability before
                confirming dispatch.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Delivery destination:{" "}
                {[division.name, district.name, upazila?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </section>

            <form
              className="mt-6 grid gap-4 rounded-2xl border border-border p-5 sm:p-7"
              onSubmit={(event) => void submit(event)}
            >
              <h2 className="text-xl font-semibold">Delivery address</h2>
              <p className="text-sm text-muted-foreground">
                Your address is encrypted in the Order record and shown only to
                you and authorized staff.
              </p>
              {error && (
                <p
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <label className="grid gap-2 text-sm font-medium">
                Recipient name
                <Input
                  autoComplete="name"
                  maxLength={120}
                  required
                  value={form.recipientName}
                  onChange={(event) =>
                    setForm({ ...form, recipientName: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Bangladesh mobile number
                <Input
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={32}
                  placeholder="01XXXXXXXXX or +8801XXXXXXXXX"
                  required
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Locality / area
                <Input
                  autoComplete="address-level3"
                  maxLength={160}
                  required
                  value={form.locality}
                  onChange={(event) =>
                    setForm({ ...form, locality: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Doorstep delivery details
                <Textarea
                  autoComplete="street-address"
                  maxLength={400}
                  required
                  value={form.doorstepDetails}
                  onChange={(event) =>
                    setForm({ ...form, doorstepDetails: event.target.value })
                  }
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <OptionalField
                  label="House / building"
                  value={form.house}
                  onChange={(house) => setForm({ ...form, house })}
                />
                <OptionalField
                  label="Street"
                  value={form.street}
                  onChange={(street) => setForm({ ...form, street })}
                />
                <OptionalField
                  label="Postal code"
                  value={form.postalCode}
                  onChange={(postalCode) => setForm({ ...form, postalCode })}
                />
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Delivery instructions (optional)
                <Textarea
                  maxLength={400}
                  value={form.instructions}
                  onChange={(event) =>
                    setForm({ ...form, instructions: event.target.value })
                  }
                />
              </label>
              <Button
                className="mt-2 w-fit"
                disabled={submitting}
                type="submit"
              >
                {submitting ? "Placing COD order…" : "Place COD order"}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function MoneyRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatCatalogPrice({ amountBdt: amount })}</dd>
    </div>
  );
}

function OptionalField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Input
        maxLength={160}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
