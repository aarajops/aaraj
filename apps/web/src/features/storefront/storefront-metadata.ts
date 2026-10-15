import "server-only";

import type { PublicStorefrontSettings } from "@aaraj/contracts";
import { getPublicStorefrontSettings } from "./storefront-settings";

export function getStorefrontShareImage(settings: PublicStorefrontSettings) {
  if (settings.socialImage) {
    const shareImage = settings.socialImage;
    return {
      url: shareImage.src,
      width: shareImage.width,
      height: shareImage.height,
      type: shareImage.contentType,
      alt: settings.socialImageAlt ?? `${settings.siteName} storefront`,
    };
  }

  if (settings.logo) {
    return {
      url: settings.logo.src,
      width: settings.logo.width,
      height: settings.logo.height,
      type: settings.logo.contentType,
      alt: `${settings.siteName} logo`,
    };
  }

  return {
    url: "/aaraj-social.png",
    width: 1200,
    height: 630,
    type: "image/png",
    alt: `${settings.siteName} logo`,
  };
}

export async function getStorefrontMetadataDefaults() {
  const settings = await getPublicStorefrontSettings();
  const title = settings.seoTitle ?? `${settings.siteName} | Products`;
  const description =
    settings.seoDescription ?? `Browse products from ${settings.siteName}.`;
  const image = getStorefrontShareImage(settings);

  return { settings, title, description, image };
}
