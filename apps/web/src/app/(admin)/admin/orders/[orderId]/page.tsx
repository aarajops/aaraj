import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { OrderReview } from "@/features/orders/order-review";
import { getManagedOrder } from "@/features/orders/orders-queries";

export const metadata: Metadata = {
  title: "Review Order",
  description: "Review COD Order details and delivery serviceability.",
};

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!OrderIdSchema.safeParse(orderId).success) notFound();
  const result = await getManagedOrder(orderId);
  if ("kind" in result) {
    return (
      <>
        <div>
          <AdminPageHeader
            title="Order review"
            description="Review fulfillment, delivery, and COD collection."
          />
          <p
            className="mt-6 rounded-xl border border-border p-5 text-muted-foreground"
            role="status"
          >
            {result.kind === "unauthenticated"
              ? "Sign in with an Aaraj staff account to review this Order."
              : result.kind === "forbidden"
                ? "Your account cannot access customer Order details."
                : result.kind === "not-found"
                  ? "This Order does not exist."
                  : "The Order could not be loaded. Try again shortly."}
          </p>
        </div>
      </>
    );
  }
  return <OrderReview initialOrder={result.value} />;
}
