import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

type OffsetPage = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

type CollectionPaginationProps = {
  label: string;
  pathname: string;
  page: OffsetPage;
  itemCount: number;
  itemName: string;
  query?: Readonly<
    Record<string, string | number | readonly string[] | undefined>
  >;
  className?: string;
  scroll?: boolean;
  showCount?: boolean;
};

export function CollectionPagination({
  label,
  pathname,
  page,
  itemCount,
  itemName,
  query,
  className,
  scroll,
  showCount = true,
}: CollectionPaginationProps) {
  const hasPrevious = page.offset > 0;
  const showItemCount = showCount && itemCount > 0;
  const showOffsetWarning = page.hasMore && page.nextOffset === null;

  if (
    !showItemCount &&
    !hasPrevious &&
    page.nextOffset === null &&
    !showOffsetWarning
  ) {
    return null;
  }

  const previousOffset = Math.max(0, page.offset - page.limit);

  function pageHref(offset: number) {
    const params = new URLSearchParams();

    for (const [name, value] of Object.entries(query ?? {})) {
      if (name === "limit" || name === "offset" || value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry) params.append(name, entry);
        }
      } else if (value !== "") {
        params.set(name, String(value));
      }
    }

    params.set("limit", String(page.limit));
    if (offset > 0) params.set("offset", String(offset));

    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      {showItemCount && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Showing {page.offset + 1}–{page.offset + itemCount} {itemName}
        </p>
      )}

      {(hasPrevious || page.nextOffset !== null) && (
        <Pagination aria-label={`${label} pagination`} className="mx-0 w-auto">
          <PaginationContent>
            {hasPrevious && (
              <PaginationItem>
                <PaginationPrevious
                  href={pageHref(previousOffset)}
                  rel="prev"
                  scroll={scroll}
                  text="Previous"
                />
              </PaginationItem>
            )}
            {page.nextOffset !== null && (
              <PaginationItem>
                <PaginationNext
                  href={pageHref(page.nextOffset)}
                  rel="next"
                  scroll={scroll}
                  text="Next"
                />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}

      {showOffsetWarning && (
        <p className="basis-full text-sm text-warning" role="status">
          More {itemName} exist, but this list has reached the maximum supported
          offset.
        </p>
      )}
    </div>
  );
}
