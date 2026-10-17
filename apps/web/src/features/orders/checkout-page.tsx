"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type AuthoritativeQuote,
  type BangladeshGeography,
  CheckoutAddressInputSchema,
  type CreateOrderInput,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import { useForm } from "react-hook-form";
import { z } from "zod";

const checkoutAddressFormSchema = CheckoutAddressInputSchema.omit({
  geographyVersion: true,
  divisionId: true,
  districtId: true,
  upazilaId: true,
})
  .required()
  .extend({ requestIdempotencyKey: z.uuid().optional() });

type CheckoutAddressFormDraft = z.input<typeof checkoutAddressFormSchema>;
type CheckoutAddressFormValues = z.output<typeof checkoutAddressFormSchema>;

const initialForm: CheckoutAddressFormDraft = {
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
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutAddressFormDraft, unknown, CheckoutAddressFormValues>({
    resolver: zodResolver(checkoutAddressFormSchema),
    defaultValues: initialForm,
  });

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
    setValue("requestIdempotencyKey", key, { shouldValidate: false });

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
  }, [quoteId, router, setValue]);

  const division = geography?.locations.find(
    ({ id }) => id === quote?.destination.divisionId,
  );
  const district = geography?.locations.find(
    ({ id }) => id === quote?.destination.districtId,
  );
  const upazila = quote?.destination.upazilaId
    ? geography?.locations.find(({ id }) => id === quote.destination.upazilaId)
    : undefined;

  async function submit(values: CheckoutAddressFormValues) {
    const { requestIdempotencyKey, ...addressValues } = values;
    if (!quote || !division || !district || !requestIdempotencyKey) return;
    setError(null);
    const input: CreateOrderInput = {
      quoteId: quote.id,
      address: {
        ...addressValues,
        geographyVersion: quote.destination.geographyVersion,
        divisionId: division.id,
        districtId: district.id,
        ...(upazila ? { upazilaId: upazila.id } : {}),
      },
    };
    try {
      const order = await createCodOrder(input, requestIdempotencyKey);
      router.push(`/orders/${order.id}`);
    } catch (reason) {
      if (
        reason instanceof OrderRequestError &&
        ["IDEMPOTENCY_KEY_REUSED", "ORDER_CHECKOUT_CONFLICT"].includes(
          reason.errorCode ?? "",
        )
      ) {
        try {
          const existing = await resumeCodOrder(requestIdempotencyKey);
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
                {quote.tax.mode !== "disabled" && (
                  <MoneyRow
                    label="Tax included in merchandise"
                    amount={quote.tax.merchandise.taxAmountBdt}
                  />
                )}
                {quote.tax.mode !== "disabled" &&
                  quote.delivery.tax.taxAmountBdt > 0 && (
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
              noValidate
              onSubmit={handleSubmit(submit)}
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
              <Field>
                <FieldLabel htmlFor="checkout-recipient-name">
                  Recipient name
                </FieldLabel>
                <Input
                  id="checkout-recipient-name"
                  autoComplete="name"
                  maxLength={120}
                  aria-invalid={Boolean(errors.recipientName)}
                  aria-describedby={
                    errors.recipientName
                      ? "checkout-recipient-name-error"
                      : undefined
                  }
                  {...register("recipientName")}
                />
                {errors.recipientName?.message && (
                  <FieldError id="checkout-recipient-name-error">
                    {errors.recipientName.message}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="checkout-phone">
                  Bangladesh mobile number
                </FieldLabel>
                <Input
                  id="checkout-phone"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={32}
                  placeholder="01XXXXXXXXX or +8801XXXXXXXXX"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? "checkout-phone-error" : undefined
                  }
                  {...register("phone")}
                />
                {errors.phone?.message && (
                  <FieldError id="checkout-phone-error">
                    {errors.phone.message}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="checkout-locality">
                  Locality / area
                </FieldLabel>
                <Input
                  id="checkout-locality"
                  autoComplete="address-level3"
                  maxLength={160}
                  aria-invalid={Boolean(errors.locality)}
                  aria-describedby={
                    errors.locality ? "checkout-locality-error" : undefined
                  }
                  {...register("locality")}
                />
                {errors.locality?.message && (
                  <FieldError id="checkout-locality-error">
                    {errors.locality.message}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="checkout-doorstep-details">
                  Doorstep delivery details
                </FieldLabel>
                <Textarea
                  id="checkout-doorstep-details"
                  autoComplete="street-address"
                  maxLength={400}
                  aria-invalid={Boolean(errors.doorstepDetails)}
                  aria-describedby={
                    errors.doorstepDetails
                      ? "checkout-doorstep-details-error"
                      : undefined
                  }
                  {...register("doorstepDetails")}
                />
                {errors.doorstepDetails?.message && (
                  <FieldError id="checkout-doorstep-details-error">
                    {errors.doorstepDetails.message}
                  </FieldError>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["house", "House / building"],
                    ["street", "Street"],
                    ["postalCode", "Postal code"],
                  ] as const
                ).map(([name, label]) => {
                  const fieldError = errors[name]?.message;
                  const errorId = `checkout-${name}-error`;
                  return (
                    <Field key={name}>
                      <FieldLabel htmlFor={`checkout-${name}`}>
                        {label}
                      </FieldLabel>
                      <Input
                        id={`checkout-${name}`}
                        maxLength={
                          name === "house" ? 120 : name === "street" ? 160 : 20
                        }
                        aria-invalid={Boolean(fieldError)}
                        aria-describedby={fieldError ? errorId : undefined}
                        {...register(name)}
                      />
                      {fieldError && (
                        <FieldError id={errorId}>{fieldError}</FieldError>
                      )}
                    </Field>
                  );
                })}
              </div>
              <Field>
                <FieldLabel htmlFor="checkout-instructions">
                  Delivery instructions (optional)
                </FieldLabel>
                <Textarea
                  id="checkout-instructions"
                  maxLength={400}
                  aria-invalid={Boolean(errors.instructions)}
                  aria-describedby={
                    errors.instructions
                      ? "checkout-instructions-error"
                      : undefined
                  }
                  {...register("instructions")}
                />
                {errors.instructions?.message && (
                  <FieldError id="checkout-instructions-error">
                    {errors.instructions.message}
                  </FieldError>
                )}
              </Field>
              <Button
                className="mt-2 w-fit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Placing COD order…" : "Place COD order"}
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
