"use client";

import type {
  CatalogCategory,
  CatalogCategoryManagementListQuery,
  CatalogCategoryPage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { Pencil } from "lucide-react";

const columnHelper = createDataTableColumnHelper<CatalogCategory>();

export function CategoryTable({
  categories,
  query,
  page,
  onRefresh,
  onEditCategory,
  isRefreshing,
}: {
  categories: CatalogCategory[];
  query: CatalogCategoryManagementListQuery;
  page: Pick<
    CatalogCategoryPage,
    "limit" | "offset" | "hasMore" | "nextOffset"
  >;
  onRefresh: () => void;
  onEditCategory: (category: CatalogCategory) => void;
  isRefreshing?: boolean;
}) {
  const columns = columnHelper.columns([
    columnHelper.accessor("path", {
      header: "Category",
      cell: ({ getValue }) => (
        <span className="whitespace-normal font-medium">{getValue()}</span>
      ),
    }),
    columnHelper.accessor("slug", {
      header: "Slug",
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">/{getValue()}</span>
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
  ]);

  return (
    <AdminDataTable
      ariaLabel="Product categories"
      columns={columns}
      data={categories}
      rowActions={(category) => (
        <DropdownMenuItem onClick={() => onEditCategory(category)}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit category
        </DropdownMenuItem>
      )}
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
          allLabel: "All types",
          value: query.kind ?? "",
          options: [
            { value: "leaf", label: "Product categories" },
            { value: "parent", label: "Category groups" },
          ],
        },
      ]}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      page={page}
    />
  );
}
