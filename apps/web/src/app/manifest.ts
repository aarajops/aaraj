import type { MetadataRoute } from "next";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getPublicStorefrontSettings();
  const shortName = Array.from(settings.siteName)
    .slice(0, 12)
    .join("")
    .trimEnd();

  return {
    id: "/",
    name: settings.siteName,
    short_name: shortName || settings.siteName,
    description:
      settings.seoDescription ?? `Browse products from ${settings.siteName}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: settings.backgroundColor,
    theme_color: settings.brandColor,
    prefer_related_applications: false,
    icons: [192, 512].map((dimension) => ({
      src: `/icon/${dimension}`,
      sizes: `${dimension}x${dimension}`,
      type: "image/png",
      purpose: "any",
    })),
  };
}
