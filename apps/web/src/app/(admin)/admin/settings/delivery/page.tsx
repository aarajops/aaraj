import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInitialAccess } from "@/features/auth/auth-session";
import { DeliveryTariffManager } from "@/features/admin/delivery-tariff-manager";

export const metadata: Metadata = {
  title: "Delivery rates",
  description: "Configure Bangladesh delivery rates and areas.",
};

export default async function DeliverySettingsPage() {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("delivery.tariff.manage")) redirect("/");

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Delivery rates
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Set Bangladesh delivery rates, district defaults, and upazila
          overrides. Saving applies the rates to new quotes immediately; placed
          orders keep their saved delivery amount.
        </p>
        <DeliveryTariffManager />
      </div>
    </main>
  );
}
