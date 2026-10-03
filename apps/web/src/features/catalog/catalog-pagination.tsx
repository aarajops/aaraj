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
      className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"
    >
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {productCount === 0
          ? "No products on this page"
          : `Showing ${offset + 1}–${offset + productCount} products`}
        <span className="ml-2 text-muted-foreground/70">Page {pageNumber}</span>
      </p>
      <div className="flex items-center gap-3">
        {hasPrevious ? (
          <Link
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href={pageHref(pathname, limit, previousOffset)}
            rel="prev"
          >
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground/50"
          >
            Previous
          </span>
        )}
        {hasNext ? (
          <Link
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href={pageHref(pathname, limit, nextOffset)}
            rel="next"
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground/50"
          >
            Next
          </span>
        )}
      </div>
      {hasMore && !hasNext && (
        <p className="basis-full text-sm text-warning" role="status">
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
