import "server-only";

import { cache } from "react";
import {
  DEFAULT_STOREFRONT_BACKGROUND_COLOR,
  DEFAULT_STOREFRONT_BRAND_COLOR,
  DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS,
  PublicStorefrontSettingsSchema,
  type PublicStorefrontSettings,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

const fallbackSettings: PublicStorefrontSettings = {
  siteName: "AARAJ",
  brandColor: DEFAULT_STOREFRONT_BRAND_COLOR,
  backgroundColor: DEFAULT_STOREFRONT_BACKGROUND_COLOR,
  seoTitle: null,
  seoDescription: null,
  announcementEnabled: false,
  announcementText: null,
  supportPhone: null,
  supportEmail: null,
  businessAddress: null,
  logo: null,
  brandIcon: null,
  favicon: null,
  socialImage: null,
  socialImageAlt: null,
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
    youtube: null,
    x: null,
  },
  headerNavigation: [...DEFAULT_PUBLIC_STOREFRONT_HEADER_LINKS],
  footerDescription: null,
  footerLinks: [],
};

export const getPublicStorefrontSettings = cache(
  async (): Promise<PublicStorefrontSettings> => {
    try {
      const response = await fetch(
        `${getApiInternalUrl()}/api/v1/storefront/settings`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        console.error("Public storefront settings could not be loaded.");
        return fallbackSettings;
      }

      const result = PublicStorefrontSettingsSchema.safeParse(
        await response.json(),
      );
      if (!result.success) {
        console.error("Public storefront settings failed contract validation.");
        return fallbackSettings;
      }
      return result.data;
    } catch {
      console.error("Public storefront settings could not be loaded.");
      return fallbackSettings;
    }
  },
);
