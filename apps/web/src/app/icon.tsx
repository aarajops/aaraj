import { ImageResponse } from "next/og";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Icon() {
  const settings = await getPublicStorefrontSettings();
  if (settings.favicon) {
    try {
      const response = await fetch(
        new URL(settings.favicon.src, getApiInternalUrl()),
        { cache: "no-store" },
      );
      if (response.ok && response.headers.get("content-type") === "image/png") {
        return new Response(await response.arrayBuffer(), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    } catch {
      // A generated monogram below keeps the app icon available during storage outages.
    }
  }

  const fallback = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#7f2527",
        color: "white",
        fontSize: 44,
        fontWeight: 700,
      }}
    >
      {settings.siteName.slice(0, 1).toUpperCase()}
    </div>,
    size,
  );
  return new Response(fallback.body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
