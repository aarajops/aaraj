import {
  API_V1_BASE_PATH,
  StorefrontBrandAssetSchema,
  type StorefrontBrandAsset,
} from "@aaraj/contracts";
import { storefrontBrandAsset } from "./storefront-schema.js";

export function toStorefrontBrandAsset(
  asset: typeof storefrontBrandAsset.$inferSelect,
): StorefrontBrandAsset {
  return StorefrontBrandAssetSchema.parse({
    id: asset.id,
    src: `${API_V1_BASE_PATH}/storefront/assets/${asset.id}/${asset.sha256}.${asset.kind === "favicon" ? "png" : "webp"}`,
    contentType: asset.contentType,
    width: asset.width,
    height: asset.height,
  });
}
