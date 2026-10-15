import "server-only";

import type {
  PublicStorefrontSettings,
  StorefrontBrandAsset,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import { getStorefrontOrigin } from "@/lib/storefront-origin";

const MAX_BRAND_ASSET_BYTES = 5 * 1024 * 1024;

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function readConfiguredAsset(
  asset: StorefrontBrandAsset | null,
): Promise<string | null> {
  if (!asset) return null;

  try {
    const assetUrl = new URL(asset.src, getApiInternalUrl());
    const contentType = "image/png";
    if (asset.contentType !== "image/png") {
      assetUrl.searchParams.set("format", "png");
    }
    const response = await fetch(assetUrl, { cache: "no-store" });
    if (!response.ok || response.headers.get("content-type") !== contentType) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > MAX_BRAND_ASSET_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= MAX_BRAND_ASSET_BYTES
      ? toDataUrl(bytes, contentType)
      : null;
  } catch {
    return null;
  }
}

function getPublicIconSource(): string {
  return new URL("/aaraj-icon.svg", getStorefrontOrigin()).toString();
}

export async function getStorefrontBrandIconSource(
  settings: PublicStorefrontSettings,
  preferBrowserFavicon = false,
): Promise<string> {
  const configuredAssets = preferBrowserFavicon
    ? [settings.favicon, settings.brandIcon]
    : [settings.brandIcon];

  for (const asset of configuredAssets) {
    const source = await readConfiguredAsset(asset);
    if (source) return source;
  }

  return getPublicIconSource();
}
