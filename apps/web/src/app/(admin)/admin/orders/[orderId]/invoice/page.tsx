import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { OrderReceiptPage } from "@/features/orders/order-receipt-page";
import { getManagedOrder } from "@/features/orders/orders-queries";

export const metadata: Metadata = {
  title: "Order delivery receipt",
  description: "Issue or print a saved order delivery receipt.",
};

export default async function AdminOrderInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  if (!OrderIdSchema.safeParse(orderId).success) notFound();

  const result = await getManagedOrder(orderId);
  if ("kind" in result) {
    if (result.kind === "not-found") notFound();

    const message =
      result.kind === "unauthenticated"
        ? "Sign in with an AARAJ staff account to view this receipt."
        : result.kind === "forbidden"
          ? "Your account cannot access customer order details."
          : "The receipt could not be loaded. Try again shortly.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Delivery receipt"
            description="Issue or print a saved order delivery receipt."
          />
          <p
            className="mt-6 rounded-xl border border-border p-5 text-muted-foreground"
            role="status"
          >
            {message}
          </p>
        </div>
      </>
    );
  }

  return (
    <OrderReceiptPage autoPrint={query.print === "1"} order={result.value} />
  );
}
