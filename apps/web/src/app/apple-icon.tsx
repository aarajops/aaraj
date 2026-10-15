import { ImageResponse } from "next/og";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";
import { getStorefrontBrandIconSource } from "@/features/storefront/storefront-brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const settings = await getPublicStorefrontSettings();
  const iconSource = await getStorefrontBrandIconSource(settings);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: settings.backgroundColor,
      }}
    >
      <img
        alt=""
        src={iconSource}
        width={size.width}
        height={size.height}
        style={{ objectFit: "contain" }}
      />
    </div>,
    {
      ...size,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
