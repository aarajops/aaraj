import { z } from "zod";

export const MAX_CATALOG_SEARCH_LENGTH = 160;

export const CatalogSearchQuerySchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(MAX_CATALOG_SEARCH_LENGTH).optional(),
);
