import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInitialAccess } from "@/features/auth/auth-session";
import { StorefrontSettingsManager } from "@/features/admin/storefront-settings-manager";

export const metadata: Metadata = {
  title: "Storefront settings",
  description:
    "Manage the public AARAJ storefront identity and contact details.",
};

export default async function StorefrontSettingsPage() {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("storefront.settings.manage")) redirect("/");

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          AARAJ ADMIN
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Storefront settings
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Manage public store identity, the announcement banner, and customer
          support contact details.
        </p>
        <StorefrontSettingsManager />
      </div>
    </main>
  );
}
