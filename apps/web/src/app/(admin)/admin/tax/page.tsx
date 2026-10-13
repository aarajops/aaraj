import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInitialAccess } from "@/features/auth/auth-session";
import { TaxSettingsManager } from "@/features/admin/tax-settings-manager";

export const metadata: Metadata = {
  title: "Tax settings",
  description: "Control tax calculation for AARAJ customer quotes.",
};

export default async function TaxSettingsPage() {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("tax.manage")) redirect("/");

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Tax settings
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Control whether tax is calculated in new customer quotes and orders.
        </p>
        <TaxSettingsManager />
      </div>
    </main>
  );
}
