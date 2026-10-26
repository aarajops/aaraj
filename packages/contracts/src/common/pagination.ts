import { z } from "zod";

/** Shared server-side default page size for paginated collections. */
export const DEFAULT_LIST_PAGE_SIZE = 20;
export const MAX_LIST_PAGE_SIZE = 100;

/**
 * Guardrail for offset-based lists. Prefer cursor pagination when collection
 * size or query plans make deep offsets expensive.
 */
export const MAX_LIST_OFFSET = 100_000;

export const ListPageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIST_PAGE_SIZE)
  .default(DEFAULT_LIST_PAGE_SIZE);

export const OffsetPaginationQuerySchema = z.strictObject({
  limit: ListPageSizeSchema,
  offset: z.coerce.number().int().min(0).max(MAX_LIST_OFFSET).default(0),
});

export const OffsetPaginationMetadataSchema = z.strictObject({
  limit: z.number().int().min(1).max(MAX_LIST_PAGE_SIZE),
  offset: z.number().int().min(0).max(MAX_LIST_OFFSET),
  hasMore: z.boolean(),
  nextOffset: z.number().int().min(0).max(MAX_LIST_OFFSET).nullable(),
});

export const CursorPaginationMetadataSchema = z.strictObject({
  nextCursor: z.string().nullable(),
});
