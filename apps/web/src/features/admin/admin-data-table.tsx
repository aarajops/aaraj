"use client";

import { useState, useTransition, type SubmitEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RowData } from "@tanstack/react-table";
import { RefreshCw, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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

export { createDataTableColumnHelper };

export type AdminDataTableFilter = {
  name: string;
  label: string;
  allLabel?: string;
  value: string;
  options: readonly { label: string; value: string }[];
};

type TableQuery = Readonly<Record<string, string | number | undefined>>;

type AdminDataTableProps<TData extends RowData & { id: string }> = {
  ariaLabel: string;
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  emptyMessage: string;
  pathname: string;
  query: TableQuery;
  itemName: string;
  searchPlaceholder: string;
  filters?: AdminDataTableFilter[];
  onRefresh: () => void;
  isRefreshing?: boolean;
  hasMore: boolean;
  nextOffset: number | null;
  className?: string;
};

export function AdminDataTable<TData extends RowData & { id: string }>({
  ariaLabel,
  columns,
  data,
  emptyMessage,
  pathname,
  query,
  itemName,
  searchPlaceholder,
  filters = [],
  onRefresh,
  isRefreshing = false,
  hasMore,
  nextOffset,
  className,
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
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  const pageNumber = Math.floor(offset / limit) + 1;
  const previousOffset = Math.max(0, offset - limit);
  const hasPrevious = offset > 0;
  const pageSizes = [...new Set([25, 50, 100, limit])].sort(
    (left, right) => left - right,
  );

  function navigate(updates: TableQuery, resetOffset = true) {
    const nextQuery: Record<string, string | number | undefined> = {
      ...query,
      search: searchDraft.trim() || undefined,
      ...updates,
    };
    if (resetOffset) nextQuery.offset = 0;

    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(nextQuery)) {
      if (value === undefined || value === "" || (name === "offset" && value === 0)) {
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
      if (value !== undefined && value !== "" && name !== "offset") {
        nextQuery.set(name, String(value));
      }
    }
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
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          aria-label={`Search ${itemName}`}
          className="flex min-w-60 flex-1 gap-2 sm:max-w-xl"
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
              className="w-full sm:w-44"
            >
              <SelectValue />
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
          className="ml-auto shrink-0"
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
        emptyMessage={emptyMessage}
      />

      <nav
        aria-label={`${ariaLabel} pagination`}
        className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4"
      >
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {data.length === 0
            ? `No ${itemName} on this page`
            : `Showing ${offset + 1}–${offset + data.length} ${itemName}`}
          <span className="ml-2">Page {pageNumber}</span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-sm text-muted-foreground"
            htmlFor={`${ariaLabel.toLowerCase().replaceAll(" ", "-")}-page-size`}
          >
            Rows per page
          </label>
          <Select
            value={String(limit)}
            onValueChange={(value) => {
              if (typeof value === "string") {
                navigate({ limit: Number(value) });
              }
            }}
          >
            <SelectTrigger
              className="w-20"
              id={`${ariaLabel.toLowerCase().replaceAll(" ", "-")}-page-size`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {pageSizes.map((pageSize) => (
                <SelectItem key={pageSize} value={String(pageSize)}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasPrevious ? (
            <Link
              aria-label={`Previous ${itemName} page`}
              className={buttonVariants({ variant: "outline" })}
              href={pageHref(previousOffset)}
              rel="prev"
              scroll={false}
            >
              Previous
            </Link>
          ) : (
            <Button aria-label={`Previous ${itemName} page`} disabled variant="outline">
              Previous
            </Button>
          )}
          {nextOffset !== null ? (
            <Link
              aria-label={`Next ${itemName} page`}
              className={buttonVariants({ variant: "outline" })}
              href={pageHref(nextOffset)}
              rel="next"
              scroll={false}
            >
              Next
            </Link>
          ) : (
            <Button aria-label={`Next ${itemName} page`} disabled variant="outline">
              Next
            </Button>
          )}
        </div>

        {hasMore && nextOffset === null && (
          <p className="basis-full text-sm text-warning" role="status">
            More {itemName} exist, but this list has reached the maximum
            supported offset.
          </p>
        )}
      </nav>
    </div>
  );
}
