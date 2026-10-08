import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderIdSchema } from "@aaraj/contracts";
import { CustomerOrderDetails } from "@/features/orders/customer-order-details";

export const metadata: Metadata = {
  title: "Order details",
  description: "View your Aaraj COD Order and delivery status.",
};

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!OrderIdSchema.safeParse(orderId).success) notFound();
  return <CustomerOrderDetails orderId={orderId} />;
}
