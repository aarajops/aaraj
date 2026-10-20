import type { Metadata } from "next";
import { CheckoutPage } from "@/features/orders/checkout-page";
import { QuoteIdSchema } from "@aaraj/contracts";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Choose delivery and complete your Cash on Delivery order.",
  robots: { index: false, follow: false },
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
  return <CheckoutPage quoteId={quoteId} />;
}
