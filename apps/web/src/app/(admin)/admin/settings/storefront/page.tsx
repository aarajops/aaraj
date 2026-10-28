import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
    <div>
      <AdminPageHeader
        title="Storefront settings"
        description="Manage the brand and content customers see in your store."
      />
      <StorefrontSettingsManager categoryOptions={categoryOptions} />
    </div>
  );
}
