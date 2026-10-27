"use client";

import { useMemo } from "react";
import type {
  CatalogCategoryOption,
  CatalogProduct,
  CatalogProductListQuery,
  CatalogProductPage,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatBdtPrice } from "@/lib/currency";
import { Pencil } from "lucide-react";

const columnHelper = createDataTableColumnHelper<CatalogProduct>();

type ProductTableProps = {
  products: CatalogProduct[];
  categoryOptions: CatalogCategoryOption[];
  query: CatalogProductListQuery;
  onRefresh: () => void;
  isRefreshing: boolean;
  page: Pick<
    CatalogProductPage,
    "limit" | "offset" | "hasMore" | "nextOffset"
  > | null;
};

export function ProductTable({
  products,
  categoryOptions,
  query,
  onRefresh,
  isRefreshing,
  page,
}: ProductTableProps) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: "Product",
          cell: ({ row }) => (
            <div className="whitespace-normal">
              <p className="font-medium text-foreground">{row.original.name}</p>
              <p className="break-all text-sm text-muted-foreground">
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
          meta: {
            align: "right",
            numeric: true,
          },
          cell: ({ row }) =>
            row.original.price
              ? formatBdtPrice(row.original.price)
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
      ]),
    [],
  );

  return (
    <AdminDataTable
      ariaLabel="Products"
      columns={columns}
      data={products}
      rowActions={(product) => (
        <DropdownMenuLinkItem
          closeOnClick
          href={`/admin/catalog/${encodeURIComponent(product.id)}/edit`}
        >
          <Pencil aria-hidden="true" className="size-4" />
          Edit product
        </DropdownMenuLinkItem>
      )}
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
      page={page}
    />
  );
}
