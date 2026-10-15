import { ImageResponse } from "next/og";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";
import { getStorefrontBrandIconSource } from "@/features/storefront/storefront-brand-icon";

const iconSizes = [64, 192, 512] as const;

export function generateImageMetadata() {
  return iconSizes.map((dimension) => ({
    id: String(dimension),
    size: { width: dimension, height: dimension },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const dimension = Number(await id);
  if (!iconSizes.some((size) => size === dimension)) {
    throw new Error("Unsupported app icon size.");
  }

  const settings = await getPublicStorefrontSettings();
  const iconSource = await getStorefrontBrandIconSource(
    settings,
    dimension === 64,
  );

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
        width={dimension}
        height={dimension}
        style={{ objectFit: "contain" }}
      />
    </div>,
    {
      width: dimension,
      height: dimension,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
