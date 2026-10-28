import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AdminPageHeader,
  adminPageLinkClassName,
} from "@/components/admin/admin-page-header";
import { StorefrontBannerManager } from "@/features/storefront/admin/storefront-banner-manager";
import {
  getManagedBannerAssets,
  getManagedStorefrontBanner,
} from "@/features/storefront/admin/storefront-banner-queries";
import { z } from "zod";

export const metadata: Metadata = {
  title: "Edit banner",
  description: "Update a storefront banner.",
};

export default async function EditStorefrontBannerPage({
  params,
}: {
  params: Promise<{ bannerId: string }>;
}) {
  const { bannerId } = await params;
  if (!z.uuid().safeParse(bannerId).success) notFound();
  const [bannerResult, assetsResult] = await Promise.all([
    getManagedStorefrontBanner(bannerId),
    getManagedBannerAssets(),
  ]);
  if ("kind" in bannerResult && bannerResult.kind === "not-found") notFound();
  if (
    ("kind" in bannerResult && bannerResult.kind === "unauthenticated") ||
    ("kind" in assetsResult && assetsResult.kind === "unauthenticated")
  ) {
    redirect("/account");
  }
  if (
    ("kind" in bannerResult && bannerResult.kind === "forbidden") ||
    ("kind" in assetsResult && assetsResult.kind === "forbidden")
  ) {
    redirect("/");
  }
  if ("kind" in bannerResult || "kind" in assetsResult) {
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
            title="Edit banner"
            description="Configure banner artwork and publishing. Set display order from the banner list."
          />
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner details could not be loaded. Return to the banner list and
            try again.
          </p>
        </div>
      </>
    );
  }

  return (
    <StorefrontBannerManager
      key={bannerResult.banner.id}
      bannerId={bannerId}
      initialBanner={bannerResult.banner}
      initialAssets={assetsResult.page}
    />
  );
}
