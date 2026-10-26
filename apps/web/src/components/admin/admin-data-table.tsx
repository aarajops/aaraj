"use client";

import {
  useState,
  useTransition,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { RowData } from "@tanstack/react-table";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableColumnDef,
} from "@/components/ui/data-table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export { createDataTableColumnHelper };

export type AdminDataTableFilter = {
  name: string;
  label: string;
  allLabel?: string;
  value: string;
  options: readonly { label: string; value: string }[];
};

type TableQuery = Readonly<Record<string, string | number | undefined>>;
type AdminDataTablePage = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

type AdminDataTableRowOrder<TData extends RowData & { id: string }> = {
  disabled?: boolean;
  getLabel: (item: TData, index: number) => string;
  onMove: (fromIndex: number, toIndex: number) => void;
};

type AdminDataTableProps<TData extends RowData & { id: string }> = {
  ariaLabel: string;
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  pathname: string;
  query: TableQuery;
  itemName: string;
  searchPlaceholder: string | null;
  emptyMessage?: ReactNode;
  filters?: AdminDataTableFilter[];
  onRefresh: () => void;
  isRefreshing?: boolean;
  page: AdminDataTablePage | null;
  className?: string;
  sortableRows?: AdminDataTableRowOrder<TData>;
};

export function AdminDataTable<TData extends RowData & { id: string }>({
  ariaLabel,
  columns,
  data,
  pathname,
  query,
  itemName,
  searchPlaceholder,
  emptyMessage,
  filters = [],
  onRefresh,
  isRefreshing = false,
  page,
  className,
  sortableRows,
}: AdminDataTableProps<TData>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const searchValue = typeof query.search === "string" ? query.search : "";
  const queryKey = JSON.stringify(query);
  const [searchDraftState, setSearchDraftState] = useState({
    queryKey,
    value: searchValue,
  });
  const searchDraft =
    searchDraftState.queryKey === queryKey
      ? searchDraftState.value
      : searchValue;
  const offset = page?.offset ?? 0;
  const previousOffset = page ? Math.max(0, offset - page.limit) : 0;
  const hasPrevious = page !== null && offset > 0;

  function navigate(updates: TableQuery, resetOffset = true) {
    const nextQuery: Record<string, string | number | undefined> = {
      ...query,
      ...(page ? { limit: page.limit } : {}),
      search: searchDraft.trim() || undefined,
      ...updates,
    };
    if (resetOffset) nextQuery.offset = 0;

    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(nextQuery)) {
      if (
        value === undefined ||
        value === "" ||
        (name === "offset" && value === 0)
      ) {
        continue;
      }
      params.set(name, String(value));
    }

    const search = params.toString();
    startTransition(() => {
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    });
  }

  function submitSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ search: searchDraft.trim() || undefined });
  }

  function pageHref(nextOffset: number) {
    const nextQuery = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (
        value !== undefined &&
        value !== "" &&
        name !== "offset" &&
        name !== "limit"
      ) {
        nextQuery.set(name, String(value));
      }
    }
    if (page) nextQuery.set("limit", String(page.limit));
    if (nextOffset > 0) nextQuery.set("offset", String(nextOffset));
    const search = nextQuery.toString();
    return search ? `${pathname}?${search}` : pathname;
  }

  const hasActiveFilters = Object.entries(query).some(
    ([name, value]) =>
      name !== "limit" &&
      name !== "offset" &&
      value !== undefined &&
      value !== "",
  );

  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
        {searchPlaceholder !== null && (
          <form
            aria-label={`Search ${itemName}`}
            className="flex min-w-60 flex-1 gap-2"
            onSubmit={submitSearch}
          >
            <InputGroup className="h-9">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={`Search ${itemName}`}
                autoComplete="off"
                name="search"
                placeholder={searchPlaceholder}
                type="search"
                value={searchDraft}
                onChange={(event) =>
                  setSearchDraftState({ queryKey, value: event.target.value })
                }
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={`Apply ${itemName} search`}
                  type="submit"
                  variant="ghost"
                >
                  <Search aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        )}

        {filters.map((filter) => (
          <Select
            key={filter.name}
            value={filter.value || "all"}
            onValueChange={(value) => {
              if (typeof value === "string") {
                navigate({
                  [filter.name]: value === "all" ? undefined : value,
                });
              }
            }}
          >
            <SelectTrigger
              aria-label={filter.label}
              className="h-9 w-full sm:w-44"
            >
              <SelectValue>
                {filter.value
                  ? (filter.options.find(
                      (option) => option.value === filter.value,
                    )?.label ?? filter.value)
                  : (filter.allLabel ?? `All ${filter.label.toLowerCase()}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">
                {filter.allLabel ?? `All ${filter.label.toLowerCase()}`}
              </SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {hasActiveFilters && (
          <Button
            className="shrink-0"
            size="lg"
            type="button"
            variant="ghost"
            onClick={() => {
              startTransition(() => router.push(pathname, { scroll: false }));
            }}
          >
            Clear filters
          </Button>
        )}

        <Button
          aria-label={`Refresh ${itemName}`}
          aria-busy={isRefreshing}
          className="ml-auto h-9 shrink-0"
          disabled={isRefreshing || isPending}
          type="button"
          variant="outline"
          onClick={() => startTransition(() => onRefresh())}
        >
          <RefreshCw
            aria-hidden="true"
            className={isRefreshing || isPending ? "animate-spin" : undefined}
          />
          <span>Refresh</span>
        </Button>
      </div>

      <DataTable
        ariaLabel={ariaLabel}
        columns={columns}
        data={data}
        sortableRows={sortableRows}
        emptyMessage={
          emptyMessage ??
          (hasActiveFilters
            ? `No matching ${itemName}.`
            : `No ${itemName} yet.`)
        }
      />

      {page &&
        (data.length > 0 ||
          hasPrevious ||
          (page.hasMore && page.nextOffset === null)) && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border px-4 py-4">
            {data.length > 0 && (
              <p aria-live="polite" className="text-sm text-muted-foreground">
                Showing {offset + 1}–{offset + data.length} {itemName}
              </p>
            )}

            <Pagination
              aria-label={`${ariaLabel} pagination`}
              className="mx-0 w-auto"
            >
              <PaginationContent>
                {hasPrevious && (
                  <PaginationItem>
                    <PaginationPrevious
                      href={pageHref(previousOffset)}
                      rel="prev"
                      scroll={false}
                      text="Previous"
                    />
                  </PaginationItem>
                )}
                {page.nextOffset !== null && (
                  <PaginationItem>
                    <PaginationNext
                      href={pageHref(page.nextOffset)}
                      rel="next"
                      scroll={false}
                      text="Next"
                    />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>

            {page.hasMore && page.nextOffset === null && (
              <p className="basis-full text-sm text-warning" role="status">
                More {itemName} exist, but this list has reached the maximum
                supported offset.
              </p>
            )}
          </div>
        )}
    </div>
  );
}
