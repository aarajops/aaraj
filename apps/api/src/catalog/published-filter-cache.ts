import {
  CatalogProductFilterOptionsSchema,
  type CatalogProductFilterOptions,
} from "@aaraj/contracts";
import { getRedisClient } from "../platform/redis/redis-client.js";

const FILTER_OPTIONS_TTL_SECONDS = 15;

function cacheKey(): string {
  const prefix = process.env.CATALOG_CACHE_KEY_PREFIX ?? "aaraj:catalog:";
  return `${prefix}published-product-filters:v1`;
}

export async function readPublishedFilterOptionsCache(): Promise<
  CatalogProductFilterOptions | undefined
> {
  try {
    const cached = await getRedisClient().get(cacheKey());
    if (!cached) return undefined;
    const parsed = CatalogProductFilterOptionsSchema.safeParse(
      JSON.parse(cached),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function writePublishedFilterOptionsCache(
  options: CatalogProductFilterOptions,
): Promise<void> {
  try {
    await getRedisClient().set(
      cacheKey(),
      JSON.stringify(options),
      "EX",
      FILTER_OPTIONS_TTL_SECONDS,
    );
  } catch {
    // Public browsing should keep working when this optional cache is down.
  }
}

export async function invalidatePublishedFilterOptionsCache(): Promise<void> {
  try {
    await getRedisClient().del(cacheKey());
  } catch {
    // The short TTL bounds staleness if Redis is temporarily unavailable.
  }
}

export function getPublishedFilterOptionsCacheKey(): string {
  return cacheKey();
}
