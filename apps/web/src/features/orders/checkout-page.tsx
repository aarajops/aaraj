"use client";

import Image from "next/image";
import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MAX_CART_QUANTITY_PER_VARIANT,
  type AuthoritativeQuote,
  type Cart,
  CheckoutAddressInputSchema,
  type CreateOrderInput,
} from "@aaraj/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { CartQuote } from "@/features/cart/cart-quote";
import { useCartStore } from "@/features/cart/cart-provider";
import { CheckoutPageSkeleton } from "./order-page-skeleton";
import { formatBdtPrice } from "@/lib/currency";
import {
  cartItem,
  cartValue,
  sendEcommerceEvent,
} from "@/features/analytics/gtm-ecommerce";
import {
  createCodOrder,
  OrderRequestError,
  resumeCodOrder,
} from "./orders-client";
import { useForm } from "react-hook-form";
import { z } from "zod";

const checkoutFormSchema = CheckoutAddressInputSchema.pick({
  recipientName: true,
  phone: true,
  doorstepDetails: true,
});

type CheckoutFormDraft = z.input<typeof checkoutFormSchema>;
type CheckoutFormValues = z.output<typeof checkoutFormSchema>;

const initialForm: CheckoutFormDraft = {
  recipientName: "",
  phone: "",
  doorstepDetails: "",
};

export function CheckoutPage({ quoteId }: { quoteId: string | null }) {
  return <SinglePageCheckout initialQuoteId={quoteId} />;
}

function SinglePageCheckout({
  initialQuoteId,
}: {
  initialQuoteId: string | null;
}) {
  const router = useRouter();
  const cart = useCartStore((state) => state.cart);
  const ready = useCartStore((state) => state.isReady);
  const cartLoading = useCartStore((state) => state.isLoading);
  const cartError = useCartStore((state) => state.error);
  const refreshCart = useCartStore((state) => state.refresh);
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [quotePending, setQuotePending] = useState(Boolean(initialQuoteId));
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const checkoutEventSent = useRef(false);
  const checkoutAttempt = useRef<{ quoteId: string; key: string } | null>(null);
  const {
    clearErrors,
    register,
    setError,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormDraft, unknown, CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: initialForm,
  });

  useEffect(() => {
    if (!ready || cart.lines.length === 0 || checkoutEventSent.current) return;
    checkoutEventSent.current = true;
    sendEcommerceEvent("begin_checkout", {
      currency: cart.currency,
      value: cartValue(cart.lines),
      items: cart.lines.map((line) => cartItem(line)),
    });
  }, [cart, ready]);

  const receiveCurrentQuote = useCallback((next: AuthoritativeQuote | null) => {
    setQuote(next);
    if (!next || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("quote") === next.id) return;
    url.searchParams.set("quote", next.id);
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  useEffect(() => {
    if (!initialQuoteId) return;
    let active = true;
    const storageKey = `aaraj.checkout.idempotency:${initialQuoteId}`;
    try {
      const key = window.sessionStorage.getItem(storageKey);
      if (!key) return;
      void resumeCodOrder(key)
        .then(async (order) => {
          if (!active) return;
          await refreshCart();
          if (active) router.replace(`/orders/${order.id}`);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          if (
            reason instanceof OrderRequestError &&
            ["CHECKOUT_NOT_FOUND", "ORDER_NOT_FOUND"].includes(
              reason.errorCode ?? "",
            )
          ) {
            return;
          }
          setCheckoutError(
            reason instanceof Error
              ? reason.message
              : "The previous order attempt could not be checked.",
          );
        });
    } catch {
      return;
    }
    return () => {
      active = false;
    };
  }, [initialQuoteId, refreshCart, router]);

  async function submit(values: CheckoutFormValues) {
    if (!quote) {
      setCheckoutError("Choose a delivery location to confirm the total.");
      return;
    }
    const key = getOrCreateIdempotencyKey(quote.id, checkoutAttempt.current);
    if (!key) {
      setCheckoutError(
        "We couldn’t safely continue checkout because browser storage is unavailable. Enable site storage, then reload before trying again.",
      );
      return;
    }
    checkoutAttempt.current = { quoteId: quote.id, key };
    setCheckoutError(null);
    clearErrors("phone");
    const input: CreateOrderInput = {
      quoteId: quote.id,
      address: {
        ...values,
        phone: `+88${values.phone}`,
        geographyVersion: quote.destination.geographyVersion,
        divisionId: quote.destination.divisionId,
        districtId: quote.destination.districtId,
        ...(quote.destination.upazilaId
          ? { upazilaId: quote.destination.upazilaId }
          : {}),
      },
    };
    try {
      const order = await createCodOrder(input, key);
      await refreshCart();
      router.push(`/orders/${order.id}`);
    } catch (reason) {
      if (
        reason instanceof OrderRequestError &&
        ["IDEMPOTENCY_KEY_REUSED", "ORDER_CHECKOUT_CONFLICT"].includes(
          reason.errorCode ?? "",
        )
      ) {
        try {
          const existing = await resumeCodOrder(key);
          await refreshCart();
          router.push(`/orders/${existing.id}`);
          return;
        } catch (resumeError) {
          if (
            resumeError instanceof OrderRequestError &&
            resumeError.errorCode === "ORDER_ACCESS_UNAVAILABLE"
          ) {
            setCheckoutError(resumeError.message);
            return;
          }
        }
      }
      if (
        reason instanceof OrderRequestError &&
        reason.errorCode === "ORDER_PHONE_INVALID"
      ) {
        setError(
          "phone",
          { type: "server", message: reason.message },
          { shouldFocus: true },
        );
        return;
      }
      setCheckoutError(
        reason instanceof OrderRequestError || reason instanceof Error
          ? reason.message
          : "The Order could not be placed. Retry with the same details.",
      );
    }
  }

  if (!ready && !cartError) return <CheckoutPageSkeleton />;

  return (
    <main className="bg-background px-5 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
          <Link className="text-sm text-primary hover:underline" href="/shop">
            Continue shopping
          </Link>
        </div>

        {cartError && (
          <div
            className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-destructive/30 py-4 text-sm"
            role="alert"
          >
            <p className="text-destructive">{cartError}</p>
            <Button
              disabled={cartLoading}
              onClick={() => void refreshCart()}
              variant="outline"
            >
              {cartLoading ? "Loading…" : "Retry"}
            </Button>
          </div>
        )}

        {ready && cart.lines.length === 0 && (
          <section className="mt-8 border-t border-border py-6">
            <h2 className="font-semibold">Your cart is empty</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Add an item to continue to checkout.
            </p>
            <Link
              className={buttonVariants({ className: "mt-5", size: "lg" })}
              href="/shop"
            >
              Browse products
            </Link>
          </section>
        )}

        {ready && cart.lines.length > 0 && (
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:gap-12">
            <div className="grid content-start gap-8">
              <CartQuote
                cart={cart}
                initialQuoteId={initialQuoteId}
                mode="checkout"
                onCurrentQuoteChange={receiveCurrentQuote}
                onQuotePendingChange={setQuotePending}
              />
              <form
                className="grid content-start gap-5"
                id="checkout-address-form"
                noValidate
                onSubmit={(event) => {
                  void handleSubmit(submit)(event);
                }}
              >
                <div>
                  <h2 className="text-xl font-semibold">Delivery details</h2>
                </div>
                {checkoutError && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {checkoutError}
                  </p>
                )}
                <Field>
                  <FieldLabel htmlFor="checkout-recipient-name">
                    Full name
                    <span aria-hidden="true" className="text-muted-foreground">
                      {" "}
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    id="checkout-recipient-name"
                    autoComplete="name"
                    maxLength={120}
                    required
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
                    Mobile number
                    <span aria-hidden="true" className="text-muted-foreground">
                      {" "}
                      *
                    </span>
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon className="h-full border-r border-input px-3 py-0">
                      <InputGroupText className="font-medium text-foreground">
                        +88
                      </InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="checkout-phone"
                      type="tel"
                      autoComplete="tel-national"
                      inputMode="tel"
                      placeholder="01XXXXXXXXX"
                      maxLength={32}
                      required
                      aria-invalid={Boolean(errors.phone)}
                      aria-describedby={
                        errors.phone ? "checkout-phone-error" : undefined
                      }
                      {...register("phone", {
                        onChange: () => clearErrors("phone"),
                      })}
                    />
                  </InputGroup>
                  {errors.phone?.message && (
                    <FieldError id="checkout-phone-error">
                      {errors.phone.message}
                    </FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="checkout-doorstep-details">
                    Delivery address
                    <span aria-hidden="true" className="text-muted-foreground">
                      {" "}
                      *
                    </span>
                  </FieldLabel>
                  <Textarea
                    id="checkout-doorstep-details"
                    autoComplete="street-address"
                    maxLength={400}
                    placeholder="Area, house/street, nearby landmark"
                    required
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
              </form>
            </div>
            <CheckoutOrderSummary
              cart={cart}
              isSubmitting={isSubmitting}
              quotePending={quotePending}
              quote={quote}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function CheckoutOrderSummary({
  cart,
  isSubmitting,
  quotePending,
  quote,
}: {
  cart: Cart;
  isSubmitting: boolean;
  quotePending: boolean;
  quote: AuthoritativeQuote | null;
}) {
  const isCartMutating = useCartStore((state) => state.isMutating);
  const setCartLine = useCartStore((state) => state.setLine);
  const removeCartLine = useCartStore((state) => state.removeLine);
  const hasUnavailableLines = cart.lines.some(
    (line) => line.availability === "unavailable",
  );
  return (
    <aside
      aria-label="Order summary"
      className="border-t border-border pt-6 lg:sticky lg:top-6 lg:self-start lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
    >
      <h2 className="text-xl font-semibold">Order summary</h2>
      <ul className="mt-4 divide-y divide-border">
        {cart.lines.map((line) => {
          const quotedLine = quote?.lines.find(
            ({ variantId }) => variantId === line.variantId,
          );
          const productName = quotedLine?.productName ?? line.product.name;
          const color = quotedLine?.color ?? line.product.color;
          const sizeLabel = quotedLine?.sizeLabel ?? line.product.sizeLabel;

          return (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
              key={line.variantId}
            >
              <Button
                aria-label={`Remove ${productName}, ${color}, ${sizeLabel}`}
                className="row-span-2 text-muted-foreground sm:row-span-1"
                disabled={isCartMutating || isSubmitting}
                onClick={() => void removeCartLine(line.variantId)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
              <div className="col-start-2 row-span-2 flex min-w-0 items-center gap-3 sm:row-span-1">
                {line.image && (
                  <Image
                    alt={line.image.altText}
                    className="size-16 shrink-0 rounded-md object-cover"
                    height={line.image.height}
                    sizes="4rem"
                    src={line.image.src}
                    unoptimized
                    width={line.image.width}
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium">{productName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {color} · {sizeLabel}
                  </p>
                  {line.availability === "unavailable" && (
                    <p className="mt-1 text-sm text-destructive">
                      No longer available
                    </p>
                  )}
                </div>
              </div>
              <div
                aria-label={`Quantity for ${productName}, ${color}, ${sizeLabel}`}
                className="col-start-3 row-start-2 inline-flex h-8 items-center justify-self-end rounded-lg border border-input px-0.5 sm:row-start-1"
                role="group"
              >
                <Button
                  aria-label={`Decrease quantity for ${productName}, ${color}, ${sizeLabel}`}
                  disabled={
                    isCartMutating ||
                    isSubmitting ||
                    line.availability === "unavailable" ||
                    line.quantity <= 1
                  }
                  onClick={() =>
                    void setCartLine(line.variantId, line.quantity - 1)
                  }
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Minus aria-hidden="true" />
                </Button>
                <span
                  aria-live="polite"
                  className="min-w-7 text-center text-sm tabular-nums"
                >
                  {line.quantity}
                </span>
                <Button
                  aria-label={`Increase quantity for ${productName}, ${color}, ${sizeLabel}`}
                  disabled={
                    isCartMutating ||
                    isSubmitting ||
                    line.availability === "unavailable" ||
                    line.quantity >= MAX_CART_QUANTITY_PER_VARIANT
                  }
                  onClick={() =>
                    void setCartLine(line.variantId, line.quantity + 1)
                  }
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
              <p className="col-start-3 row-start-1 shrink-0 text-right font-medium tabular-nums sm:col-start-4">
                {quotedLine ? (
                  formatBdtPrice({ amountBdt: quotedLine.grossAmountBdt })
                ) : (
                  <span className="text-muted-foreground">
                    {quotePending ? "Calculating…" : "—"}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <dl className="grid gap-3 border-t border-border pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd>
            {quote ? (
              formatBdtPrice({ amountBdt: quote.merchandiseGrossBdt })
            ) : (
              <span className="text-muted-foreground">
                {quotePending ? "Calculating…" : "Select location"}
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Delivery</dt>
          <dd>
            {quote ? (
              formatBdtPrice({ amountBdt: quote.delivery.grossAmountBdt })
            ) : (
              <span className="text-muted-foreground">
                {quotePending ? "Calculating…" : "Select location"}
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-4 text-base font-semibold">
          <dt>Total due on delivery</dt>
          <dd aria-live="polite">
            {quote
              ? formatBdtPrice({ amountBdt: quote.totalBdt })
              : quotePending
                ? "Calculating…"
                : "—"}
          </dd>
        </div>
      </dl>
      <Button
        className="mt-5 w-full"
        disabled={
          !quote || isSubmitting || isCartMutating || hasUnavailableLines
        }
        form="checkout-address-form"
        size="lg"
        type="submit"
      >
        {isSubmitting ? "Placing COD order…" : "Place COD order"}
      </Button>
    </aside>
  );
}

function getOrCreateIdempotencyKey(
  quoteId: string,
  currentAttempt: { quoteId: string; key: string } | null,
): string | null {
  if (currentAttempt?.quoteId === quoteId) return currentAttempt.key;

  const storageKey = `aaraj.checkout.idempotency:${quoteId}`;
  try {
    const storedKey = window.sessionStorage.getItem(storageKey);
    if (storedKey && /^[0-9a-f-]{36}$/i.test(storedKey)) return storedKey;
    const key = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, key);
    return window.sessionStorage.getItem(storageKey) === key ? key : null;
  } catch {
    // A new key could turn an uncertain retry into a second Order.
    return null;
  }
}
