"use client";

import Link from "next/link";

interface CatalogPaginationProps {
  label: string;
  pathname: string;
  limit: number;
  offset: number;
  productCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export function CatalogPagination({
  label,
  pathname,
  limit,
  offset,
  productCount,
  hasMore,
  nextOffset,
}: CatalogPaginationProps) {
  const hasPrevious = offset > 0;
  const hasNext = nextOffset !== null;

  if (!hasPrevious && !hasNext && !hasMore) return null;

  const previousOffset = Math.max(0, offset - limit);
  const pageNumber = Math.floor(offset / limit) + 1;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 pt-5"
    >
      <p aria-live="polite" className="text-sm text-zinc-400">
        {productCount === 0
          ? "No products on this page"
          : `Showing ${offset + 1}–${offset + productCount} products`}
        <span className="ml-2 text-zinc-500">Page {pageNumber}</span>
      </p>
      <div className="flex items-center gap-3">
        {hasPrevious ? (
          <Link
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
            href={pageHref(pathname, limit, previousOffset)}
            rel="prev"
          >
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-600"
          >
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
            href={pageHref(pathname, limit, nextOffset)}
            rel="next"
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-600"
          >
            Next
          </span>
        )}
      </div>
      {hasMore && !hasNext && (
        <p className="basis-full text-sm text-amber-200" role="status">
          More products exist, but this listing has reached the maximum
          supported offset. Contact support for help finding another product.
        </p>
      )}
    </nav>
  );
}

function pageHref(pathname: string, limit: number, offset: number): string {
  const search = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return `${pathname}?${search}`;
}
