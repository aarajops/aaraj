"use client";

import { useMemo } from "react";
import type { CatalogCategory } from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";
import Link from "next/link";

const columnHelper = createDataTableColumnHelper<CatalogCategory>();

export function CategoryTable({
  categories,
  query,
  onRefresh,
  isRefreshing,
}: {
  categories: CatalogCategory[];
  query: {
    limit: number;
    offset: number;
    search?: string;
    status?: "active" | "inactive";
    kind?: "parent" | "leaf";
  };
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("path", {
          header: "Category",
          cell: ({ row }) => (
            <span className="min-w-40 font-medium">{row.original.path}</span>
          ),
        }),
        columnHelper.accessor("slug", {
          header: "Slug",
          cell: ({ getValue }) => (
            <span className="font-mono text-sm">/{getValue()}</span>
          ),
        }),
        columnHelper.display({
          id: "kind",
          header: "Kind",
          cell: ({ row }) => (
            <Badge variant="secondary">
              {row.original.isLeaf ? "Leaf" : "Parent"}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => (
            <Badge
              className={
                row.original.isActive
                  ? "border-success/30 bg-success/10 text-success"
                  : ""
              }
              variant={row.original.isActive ? "outline" : "secondary"}
            >
              {row.original.isActive ? "Active" : "Inactive"}
            </Badge>
          ),
        }),
        columnHelper.accessor("sortOrder", {
          header: "Order",
        }),
        columnHelper.display({
          id: "actions",
          header: "Actions",
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ variant: "outline" })}
              aria-label={`Edit ${row.original.name}`}
              href={`/admin/catalog/categories/${encodeURIComponent(row.original.id)}/edit`}
              prefetch={false}
            >
              Edit
            </Link>
          ),
        }),
      ]),
    [],
  );

  const search = query.search?.toLocaleLowerCase("en-US");
  const filteredCategories = categories.filter((category) => {
    if (query.status && category.isActive !== (query.status === "active")) {
      return false;
    }
    if (query.kind && category.isLeaf !== (query.kind === "leaf")) {
      return false;
    }
    return (
      !search ||
      [category.path, category.name, category.slug].some((value) =>
        value.toLocaleLowerCase("en-US").includes(search),
      )
    );
  });
  const visibleCategories = filteredCategories.slice(
    query.offset,
    query.offset + query.limit,
  );
  const nextOffset = query.offset + visibleCategories.length;
  const hasMore = nextOffset < filteredCategories.length;
  const hasFilters = Boolean(query.search || query.status || query.kind);

  return (
    <AdminDataTable
      ariaLabel="Product categories"
      columns={columns}
      data={visibleCategories}
      emptyMessage={
        hasFilters
          ? "No categories match the current search and filters."
          : "No categories have been created yet."
      }
      pathname="/admin/catalog/categories"
      query={query}
      itemName="categories"
      searchPlaceholder="Name, path, or slug"
      filters={[
        {
          name: "status",
          label: "Status",
          allLabel: "All statuses",
          value: query.status ?? "",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
        {
          name: "kind",
          label: "Category type",
          allLabel: "All category types",
          value: query.kind ?? "",
          options: [
            { value: "leaf", label: "Leaf" },
            { value: "parent", label: "Parent" },
          ],
        },
      ]}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      hasMore={hasMore}
      nextOffset={hasMore ? nextOffset : null}
    />
  );
}
