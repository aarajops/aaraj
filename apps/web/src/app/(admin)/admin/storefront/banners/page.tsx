import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getManagedStorefrontBanners,
  parseStorefrontBannerListQuery,
  type StorefrontBannerSearchParams,
} from "@/features/admin/storefront-banner-queries";
import { StorefrontBannerTable } from "@/features/admin/storefront-banner-table";

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
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background px-5 py-12 text-foreground sm:py-16">
        <div className="container mx-auto">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary">
            AARAJ ADMIN
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Storefront banners
          </h1>
          <p
            className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-5 text-warning"
            role="alert"
          >
            Banner records could not be loaded. Refresh the page to try again.
          </p>
        </div>
      </main>
    );
  }

  return <StorefrontBannerTable page={result.page} query={query} />;
}
