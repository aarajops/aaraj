import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getInitialAccess } from "@/features/auth/auth-session";
import { getPublicCatalogCategories } from "@/features/catalog/catalog-queries";
import { StorefrontSettingsManager } from "@/features/storefront/admin/storefront-settings-manager";

export const metadata: Metadata = {
  title: "Storefront settings",
  description:
    "Manage the AARAJ storefront brand, public profile, homepage categories, header navigation, and footer.",
};

export default async function StorefrontSettingsPage() {
  const access = await getInitialAccess();
  if (!access) redirect("/account");
  if (!access.permissions.includes("storefront.settings.manage")) redirect("/");
  const categoryOptions = await getPublicCatalogCategories();

  return (
    <main className="flex-1 bg-background px-4 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="container mx-auto">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Storefront settings
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Manage the details customers see on your store.
        </p>
        <StorefrontSettingsManager categoryOptions={categoryOptions} />
      </div>
    </main>
  );
}
