import "server-only";

import {
  PublicStorefrontSettingsSchema,
  type PublicStorefrontSettings,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";

const fallbackSettings: PublicStorefrontSettings = {
  siteName: "AARAJ",
  announcementEnabled: false,
  announcementText: null,
  supportPhone: null,
};

export async function getPublicStorefrontSettings(): Promise<PublicStorefrontSettings> {
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
}
