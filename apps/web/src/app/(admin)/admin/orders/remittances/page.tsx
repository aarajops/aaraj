import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getInitialAccess } from "@/features/auth/auth-session";
import { CourierRemittancesManager } from "@/features/orders/courier-remittances-manager";

export const metadata: Metadata = {
  title: "Courier remittances",
  description: "Import and reconcile Pathao COD remittance statements.",
};

export default async function CourierRemittancesPage() {
  const access = await getInitialAccess();
  if (!access?.permissions.includes("orders.finance.manage")) {
    return (
      <div>
        <AdminPageHeader
          title="Courier remittances"
          description="Import and reconcile Pathao COD remittance statements."
        />
        <p
          className="mt-6 rounded-xl border border-border p-5 text-muted-foreground"
          role="status"
        >
          Finance permission is required to view courier remittances.
        </p>
      </div>
    );
  }
  return <CourierRemittancesManager />;
}
