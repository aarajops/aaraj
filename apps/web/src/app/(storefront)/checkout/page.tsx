import type { Metadata } from "next";
import { CheckoutPage } from "@/features/orders/checkout-page";
import { QuoteIdSchema } from "@aaraj/contracts";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Review your Bangladesh delivery address and place a COD order.",
};

export default async function StorefrontCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string | string[] }>;
}) {
  const params = await searchParams;
  const quoteId =
    typeof params.quote === "string" &&
    QuoteIdSchema.safeParse(params.quote).success
      ? params.quote
      : null;
  return <CheckoutPage key={quoteId ?? "missing-quote"} quoteId={quoteId} />;
}
