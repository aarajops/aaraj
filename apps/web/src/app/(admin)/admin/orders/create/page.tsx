import type { Metadata } from "next";
import Link from "next/link";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import { ManualOrderForm } from "@/features/orders/manual-order-form";
import {
  getInitialAccess,
  getInitialSession,
} from "@/features/auth/auth-session";

export const metadata: Metadata = {
  title: "Create Order",
  description: "Create a confirmed COD Order from the admin panel.",
};

export default async function AdminCreateOrderPage() {
  const [session, access] = await Promise.all([
    getInitialSession(),
    getInitialAccess(),
  ]);
  const canManageOrders =
    access?.permissions.includes("orders.manage") ?? false;
  const title = canManageOrders
    ? null
    : session
      ? "Order management access required"
      : "Sign in to continue";

  return (
    <div>
      <AdminPageHeader
        title="Create Order"
        description="Create a confirmed cash on delivery Order for a customer or guest. Current catalog prices and delivery charges are checked before confirmation."
        backLink={
          <Link className={adminPageLinkClassName} href="/admin/orders">
            ← Orders
          </Link>
        }
      />
      {title ? (
        <section
          className="mt-6 rounded-xl border border-border p-5"
          role="alert"
        >
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {!session
              ? "Sign in with an Aaraj staff account to create Orders."
              : "Your account cannot create customer Orders."}
          </p>
        </section>
      ) : (
        <div className="mt-6">
          <ManualOrderForm />
        </div>
      )}
    </div>
  );
}
