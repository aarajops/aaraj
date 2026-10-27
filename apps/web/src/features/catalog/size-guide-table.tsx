"use client";

import { useMemo } from "react";
import type {
  CatalogCategoryOption,
  CatalogSizeGuideListQuery,
  CatalogSizeGuideSummary,
  CatalogSizeGuidePage,
} from "@aaraj/contracts";
import { DropdownMenuLinkItem } from "@/components/ui/dropdown-menu";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/components/admin/admin-data-table";
import { formatDateTime } from "@/lib/date-time";
import { Pencil } from "lucide-react";

const columnHelper = createDataTableColumnHelper<CatalogSizeGuideSummary>();

export function SizeGuideTable({
  guides,
  categoryOptions,
  query,
  onRefresh,
  isRefreshing,
  page,
}: {
  guides: CatalogSizeGuideSummary[];
  categoryOptions: CatalogCategoryOption[];
  query: CatalogSizeGuideListQuery;
  onRefresh: () => void;
  isRefreshing?: boolean;
  page: Pick<
    CatalogSizeGuidePage,
    "limit" | "offset" | "hasMore" | "nextOffset"
  > | null;
}) {
  const categoryPaths = useMemo(
    () => new Map(categoryOptions.map(({ id, path }) => [id, path])),
    [categoryOptions],
  );
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("name", {
          header: "Guide",
          cell: ({ row }) => (
            <span className="whitespace-normal font-medium">
              {row.original.name}
            </span>
          ),
        }),
        columnHelper.display({
          id: "category",
          header: "Category",
          cell: ({ row }) =>
            categoryPaths.get(row.original.category.id) ??
            row.original.category.name,
        }),
        columnHelper.display({
          id: "fit",
          header: "Fit",
          cell: ({ row }) => row.original.fit ?? "Any fit",
        }),
        columnHelper.accessor("measurementBasis", {
          header: "Measurements",
          cell: ({ getValue }) =>
            getValue() === "garment" ? "Garment" : "Body",
        }),
        columnHelper.accessor("sizeLabels", {
          header: "Sizes",
          cell: ({ getValue }) => getValue().join(", "),
        }),
        columnHelper.accessor("updatedAt", {
          header: "Updated",
          cell: ({ getValue }) => formatDateTime(getValue()),
        }),
      ]),
    [categoryPaths],
  );

  return (
    <AdminDataTable
      ariaLabel="Size guides"
      columns={columns}
      data={guides}
      rowActions={(guide) => (
        <DropdownMenuLinkItem
          closeOnClick
          href={`/admin/catalog/size-guides/${encodeURIComponent(guide.id)}/edit`}
        >
          <Pencil aria-hidden="true" className="size-4" />
          Edit size guide
        </DropdownMenuLinkItem>
      )}
      pathname="/admin/catalog/size-guides"
      query={query}
      itemName="size guides"
      searchPlaceholder="Guide, category, fit, or size"
      filters={[
        {
          name: "categoryId",
          label: "Category",
          allLabel: "All categories",
          value: query.categoryId ?? "",
          options: categoryOptions.map(({ id, path }) => ({
            value: id,
            label: path,
          })),
        },
        {
          name: "measurementBasis",
          label: "Measurement basis",
          allLabel: "All measurement bases",
          value: query.measurementBasis ?? "",
          options: [
            { value: "garment", label: "Garment" },
            { value: "body", label: "Body" },
          ],
        },
      ]}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
      page={page}
    />
  );
}
