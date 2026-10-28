import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { OrderInvoice } from "@/features/orders/order-invoice";
import { getManagedOrder } from "@/features/orders/orders-queries";

export const metadata: Metadata = {
  title: "Order invoice",
  description: "Print a customer order invoice.",
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
        ? "Sign in with an AARAJ staff account to print this invoice."
        : result.kind === "forbidden"
          ? "Your account cannot access customer order details."
          : "The invoice could not be loaded. Try again shortly.";

    return (
      <>
        <div>
          <AdminPageHeader
            title="Invoice"
            description="Print a customer order invoice."
          />
          <p className="mt-6 rounded-xl border border-border p-5 text-muted-foreground" role="status">
            {message}
          </p>
        </div>
      </>
    );
  }

  return <OrderInvoice autoPrint={query.print === "1"} order={result.value} />;
}
