"use server";

import { updateTag } from "next/cache";
import { getInitialAccess } from "@/features/auth/auth-session";

export async function revalidateStorefrontBanners() {
  const access = await getInitialAccess();
  if (!access?.permissions.includes("storefront.settings.manage")) return;

  updateTag("storefront-banners");
}
