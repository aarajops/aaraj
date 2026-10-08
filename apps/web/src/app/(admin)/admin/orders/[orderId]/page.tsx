import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
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
      <main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background px-5 py-12 text-foreground sm:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border p-7">
          <h1 className="text-2xl font-semibold">Order review unavailable</h1>
          <p className="mt-3 text-muted-foreground">
            {result.kind === "unauthenticated"
              ? "Sign in with an Aaraj staff account to review this Order."
              : result.kind === "forbidden"
                ? "Your account cannot access customer Order details."
                : result.kind === "not-found"
                  ? "This Order does not exist."
                  : "The Order could not be loaded. Try again shortly."}
          </p>
        </div>
      </main>
    );
  }
  return <OrderReview initialOrder={result.value} />;
}
