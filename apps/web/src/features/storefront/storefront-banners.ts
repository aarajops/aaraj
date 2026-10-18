import "server-only";

import {
  API_V1_BASE_PATH,
  PublicStorefrontBannersSchema,
  StorefrontBannerPlacementSchema,
  STOREFRONT_BANNER_CACHE,
  type StorefrontBannerPlacement,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

export async function getPublicStorefrontBanners(
  placement: StorefrontBannerPlacement,
) {
  const parsedPlacement = StorefrontBannerPlacementSchema.safeParse(placement);
  if (!parsedPlacement.success) return null;

  try {
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/storefront/banners/${parsedPlacement.data}`,
      {
        next: {
          revalidate: STOREFRONT_BANNER_CACHE.revalidateSeconds,
          tags: ["storefront-banners"],
        },
      },
    );
    if (!response.ok) return null;
    const result = PublicStorefrontBannersSchema.nullable().safeParse(
      await response.json(),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
