"use client";

import { useMemo } from "react";
import type {
  CatalogCategoryOption,
  CatalogProduct,
  CatalogProductListQuery,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";
import { formatCatalogPrice } from "@/features/catalog/price";
import Link from "next/link";

const columnHelper = createDataTableColumnHelper<CatalogProduct>();

type ProductTableProps = {
  products: CatalogProduct[];
  categoryOptions: CatalogCategoryOption[];
  query: CatalogProductListQuery;
  onRefresh: () => void;
  isRefreshing: boolean;
  hasMore: boolean;
  nextOffset: number | null;
};

export function ProductTable({
  products,
  categoryOptions,
  query,
  onRefresh,
  isRefreshing,
  hasMore,
  nextOffset,
}: ProductTableProps) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: "Product",
          cell: ({ row }) => (
            <div className="min-w-40">
              <p className="truncate font-medium text-foreground">
                {row.original.name}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                /{row.original.slug}
              </p>
            </div>
          ),
        }),
        columnHelper.display({
          id: "category",
          header: "Category",
          cell: ({ row }) => row.original.category?.name ?? "Uncategorized",
        }),
        columnHelper.display({
          id: "price",
          header: "Price",
          cell: ({ row }) =>
            row.original.price
              ? formatCatalogPrice(row.original.price)
              : "Price not set",
        }),
        columnHelper.display({
          id: "status",
          header: "Status",
          cell: ({ row }) => (
            <Badge
              className={
                row.original.isPublished
                  ? "border-success/30 bg-success/10 text-success"
                  : ""
              }
              variant={row.original.isPublished ? "outline" : "secondary"}
            >
              {row.original.isPublished ? "Published" : "Draft"}
            </Badge>
          ),
        }),
        columnHelper.display({
          id: "actions",
          header: "Actions",
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ variant: "outline" })}
              aria-label={`Edit ${row.original.name}`}
              href={`/admin/catalog/${encodeURIComponent(row.original.id)}/edit`}
              prefetch={false}
            >
              Edit
            </Link>
          ),
        }),
      ]),
    [],
  );

  const hasFilters = Boolean(query.search || query.categoryId || query.status);

  return (
    <AdminDataTable
      ariaLabel="Products"
      columns={columns}
      data={products}
      emptyMessage={
        hasFilters
          ? "No products match the current search and filters."
          : "No products have been created yet."
      }
      pathname="/admin/catalog"
      query={query}
      itemName="products"
      searchPlaceholder="Name, slug, or SKU"
      filters={[
        {
          name: "status",
          label: "Publication status",
          allLabel: "All statuses",
          value: query.status ?? "",
          options: [
            { value: "published", label: "Published" },
            { value: "draft", label: "Draft" },
          ],
        },
        {
          name: "categoryId",
          label: "Category",
          allLabel: "All categories",
          value: query.categoryId ?? "",
          options: categoryOptions
            .filter(({ isLeaf }) => isLeaf)
            .map(({ id, path }) => ({ value: id, label: path }))
            .concat({ value: "uncategorized", label: "Uncategorized" }),
        },
      ]}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      hasMore={hasMore}
      nextOffset={nextOffset}
    />
  );
}
