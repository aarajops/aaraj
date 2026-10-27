import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
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
      <main className="flex-1 bg-background px-5 py-12 text-foreground sm:px-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-border p-7">
          <h1 className="text-2xl font-semibold">Invoice unavailable</h1>
          <p className="mt-3 text-muted-foreground">{message}</p>
        </div>
      </main>
    );
  }

  return <OrderInvoice autoPrint={query.print === "1"} order={result.value} />;
}
