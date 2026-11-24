"use client";

import { useMemo } from "react";
import type {
  CatalogCategoryOption,
  CatalogProductListQuery,
  CatalogProductPage,
} from "@aaraj/contracts";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { ProductPrice } from "@/features/catalog/product-price";
import { managedProductMediaPreviewUrl } from "@/features/catalog/catalog-client";
import { formatDateTime } from "@/lib/date-time";
import { ImageOff, Pencil } from "lucide-react";

type CatalogProductRow = CatalogProductPage["products"][number];

const columnHelper = createDataTableColumnHelper<CatalogProductRow>();

type ProductTableProps = {
  products: CatalogProductPage["products"];
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
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-12 shrink-0">
                {row.original.thumbnail ? (
                  <AspectRatio
                    aria-hidden="true"
                    className="overflow-hidden rounded-md border bg-muted"
                    ratio="square"
                  >
                    <Image
                      alt=""
                      className="object-cover"
                      fill
                      src={managedProductMediaPreviewUrl(
                        row.original.id,
                        row.original.thumbnail.mediaId,
                      )}
                      unoptimized
                    />
                  </AspectRatio>
                ) : (
                  <AspectRatio
                    aria-hidden="true"
                    className="grid place-items-center rounded-md border bg-muted text-muted-foreground"
                    ratio="square"
                  >
                    <ImageOff aria-hidden="true" className="size-4" />
                  </AspectRatio>
                )}
              </div>
              <div className="min-w-0 whitespace-normal">
                <p className="font-medium text-foreground">
                  {row.original.name}
                </p>
                {row.original.productType === "combo" && (
                  <Badge className="mt-1" variant="outline">
                    Combo
                  </Badge>
                )}
                <p className="break-all text-sm text-muted-foreground">
                  /{row.original.slug}
                </p>
              </div>
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
            row.original.price ? (
              <div className="flex justify-end">
                <ProductPrice
                  compareAtPrice={row.original.compareAtPrice}
                  price={row.original.price}
                />
              </div>
            ) : (
              "Price not set"
            ),
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
        columnHelper.accessor("updatedAt", {
          header: "Updated",
          cell: ({ getValue }) => formatDateTime(getValue()),
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
        {
          name: "sort",
          label: "Updated",
          allLabel: "Recently updated",
          value: query.sort ?? "",
          options: [
            { value: "updated-desc", label: "Recently updated" },
            { value: "updated-asc", label: "Oldest updated" },
          ],
        },
      ]}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      page={page}
    />
  );
}
