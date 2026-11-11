import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getInitialAccess } from "@/features/auth/auth-session";
import { OrderNotificationsManager } from "@/features/orders/order-notifications-manager";

export const metadata: Metadata = {
  title: "Order SMS delivery",
  description: "Review delivery of consent-based order status messages.",
};

export default async function OrderNotificationsPage() {
  const access = await getInitialAccess();
  if (!access?.permissions.includes("orders.manage")) {
    return (
      <div>
        <AdminPageHeader
          title="Order SMS delivery"
          description="Review delivery of consent-based order status messages."
        />
        <p
          className="mt-6 rounded-xl border border-border p-5 text-muted-foreground"
          role="status"
        >
          Order management permission is required to view SMS delivery status.
        </p>
      </div>
    );
  }
  return <OrderNotificationsManager />;
}
