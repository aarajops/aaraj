import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import { StorefrontBannerManager } from "@/features/storefront/admin/storefront-banner-manager";
import { getManagedBannerAssets } from "@/features/storefront/admin/storefront-banner-queries";

export const metadata: Metadata = {
  title: "Create banner",
  description: "Create a reusable banner for the storefront homepage.",
};

export default async function CreateStorefrontBannerPage() {
  const result = await getManagedBannerAssets();
  if ("kind" in result && result.kind === "unauthenticated") {
    redirect("/account");
  }
  if ("kind" in result && result.kind === "forbidden") redirect("/");
  if ("kind" in result) {
    return (
      <>
        <div>
          <AdminPageHeader
            backLink={
              <Link
                className={adminPageLinkClassName}
                href="/admin/storefront/banners"
              >
                ← Back to banners
              </Link>
            }
            title="Create banner"
            description="Configure banner artwork and publishing. Set display order from the banner list."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner images could not be loaded. Return to the banner list and try
            again.
          </p>
        </div>
      </>
    );
  }

  return <StorefrontBannerManager initialAssets={result.page} />;
}
