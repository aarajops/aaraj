import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StorefrontBannerManager } from "@/features/admin/storefront-banner-manager";
import {
  getManagedBannerAssets,
  getManagedStorefrontBanner,
} from "@/features/admin/storefront-banner-queries";
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
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="container mx-auto">
          <h1 className="text-3xl font-semibold tracking-tight">Edit banner</h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner details could not be loaded. Return to the banner list and
            try again.
          </p>
          <Link
            className="mt-5 inline-flex text-primary underline"
            href="/admin/storefront/banners"
          >
            Back to banners
          </Link>
        </div>
      </main>
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
