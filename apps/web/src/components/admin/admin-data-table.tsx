"use client";

import {
  useMemo,
  useState,
  useTransition,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { RowData } from "@tanstack/react-table";
import { EllipsisVertical, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CollectionPagination } from "@/components/collection-pagination";

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
  rowActions?: (row: TData) => ReactNode;
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
  rowActions,
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
  const tableColumns = useMemo(() => {
    if (!rowActions) return columns;

    const actionsColumn = createDataTableColumnHelper<TData>().display({
      id: "actions",
      header: "Actions",
      meta: { className: "w-16 px-2" },
      cell: ({ row }) => {
        const actions = rowActions(row.original);
        const hasActions =
          actions !== null && actions !== undefined && actions !== false;
        if (!hasActions) return null;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${ariaLabel.toLowerCase()} row ${row.index + 1}`}
              render={<Button size="icon-sm" type="button" variant="ghost" />}
            >
              <EllipsisVertical aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {actions}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });

    return [actionsColumn, ...columns];
  }, [ariaLabel, columns, rowActions]);

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
        key={queryKey}
        ariaLabel={ariaLabel}
        columns={tableColumns}
        data={data}
        sortableRows={sortableRows}
        emptyMessage={
          emptyMessage ??
          (hasActiveFilters
            ? `No matching ${itemName}.`
            : page && page.offset > 0
              ? `No ${itemName} on this page.`
              : `No ${itemName} yet.`)
        }
      />

      {page && (
        <CollectionPagination
          className="border-t border-border px-4 py-4"
          itemCount={data.length}
          itemName={itemName}
          label={ariaLabel}
          page={page}
          pathname={pathname}
          query={query}
          scroll={false}
        />
      )}
    </div>
  );
}
