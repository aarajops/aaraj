import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StorefrontBannerManager } from "@/features/admin/storefront-banner-manager";
import { getManagedBannerAssets } from "@/features/admin/storefront-banner-queries";

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
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="container mx-auto">
          <h1 className="text-3xl font-semibold tracking-tight">
            Create banner
          </h1>
          <p
            className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner images could not be loaded. Return to the banner list and try
            again.
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

  return <StorefrontBannerManager initialAssets={result.page} />;
}
