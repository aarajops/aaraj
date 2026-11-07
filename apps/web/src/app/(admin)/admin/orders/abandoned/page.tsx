import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CheckoutDraftsManager } from "@/features/orders/checkout-drafts-manager";
import {
  getCheckoutDrafts,
  parseCheckoutDraftQuery,
} from "@/features/orders/checkout-drafts-queries";

export const metadata: Metadata = {
  title: "Abandoned checkouts",
  description:
    "Review incomplete checkouts and create confirmed COD Orders after a customer agrees.",
};

export default async function AbandonedCheckoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseCheckoutDraftQuery(await searchParams);
  const result = await getCheckoutDrafts(query);
  if ("kind" in result) {
    return (
      <div>
        <AdminPageHeader
          title="Abandoned checkouts"
          description="Review incomplete checkouts and call interested customers."
        />
        <p className="mt-6 rounded-xl border border-border p-6" role="alert">
          {result.kind === "unauthenticated"
            ? "Sign in to view checkout drafts."
            : result.kind === "forbidden"
              ? "Your account cannot manage checkout drafts."
              : "Checkout drafts are unavailable. Refresh this page to try again."}
        </p>
      </div>
    );
  }
  return <CheckoutDraftsManager page={result.value} query={query} />;
}
