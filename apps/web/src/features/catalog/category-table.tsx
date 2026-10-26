"use client";

import { useMemo } from "react";
import type {
  CatalogCategory,
  CatalogCategoryManagementListQuery,
  CatalogCategoryPage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import Link from "next/link";

const columnHelper = createDataTableColumnHelper<CatalogCategory>();

export function CategoryTable({
  categories,
  query,
  page,
  onRefresh,
  isRefreshing,
}: {
  categories: CatalogCategory[];
  query: CatalogCategoryManagementListQuery;
  page: Pick<
    CatalogCategoryPage,
    "limit" | "offset" | "hasMore" | "nextOffset"
  >;
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("path", {
          header: "Category",
          cell: ({ row }) => (
            <span className="whitespace-normal font-medium">
              {row.original.path}
            </span>
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
        columnHelper.display({
          id: "actions",
          header: "Actions",
          meta: { align: "right" },
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ size: "lg", variant: "outline" })}
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

  return (
    <AdminDataTable
      ariaLabel="Product categories"
      columns={columns}
      data={categories}
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
      page={page}
    />
  );
}
