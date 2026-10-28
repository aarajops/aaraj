import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getInitialAccess } from "@/features/auth/auth-session";
import { DeliveryTariffManager } from "@/features/delivery/admin/delivery-tariff-manager";

export const metadata: Metadata = {
  title: "Delivery rates",
  description: "Configure Bangladesh delivery rates and areas.",
};

export default async function DeliverySettingsPage() {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("delivery.tariff.manage")) redirect("/");

  return (
    <div>
      <AdminPageHeader
        title="Delivery rates"
        description="Configure delivery rates and area overrides for new quotes."
      />
      <DeliveryTariffManager />
    </div>
  );
}
