import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  getManagedStorefrontBanners,
  parseStorefrontBannerListQuery,
  type StorefrontBannerSearchParams,
} from "@/features/storefront/admin/storefront-banner-queries";
import { StorefrontBannerTable } from "@/features/storefront/admin/storefront-banner-table";

export const metadata: Metadata = {
  title: "Storefront banners",
  description: "Manage reusable banners shown on the storefront homepage.",
};

export default async function StorefrontBannersPage({
  searchParams,
}: {
  searchParams: Promise<StorefrontBannerSearchParams>;
}) {
  const query = parseStorefrontBannerListQuery(await searchParams);
  const result = await getManagedStorefrontBanners(query);
  if ("kind" in result) {
    if (result.kind === "unauthenticated") redirect("/account");
    if (result.kind === "forbidden") redirect("/");
    return (
      <>
        <div>
          <AdminPageHeader
            title="Storefront banners"
            description="Manage homepage banners."
          />
          <p
            className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner records could not be loaded. Refresh the page to try again.
          </p>
        </div>
      </>
    );
  }

  return <StorefrontBannerTable page={result.page} query={query} />;
}
