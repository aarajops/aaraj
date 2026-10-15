import type { MetadataRoute } from "next";
import { getStorefrontOrigin } from "@/lib/storefront-origin";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: new URL("/sitemap.xml", getStorefrontOrigin()).toString(),
  };
}
