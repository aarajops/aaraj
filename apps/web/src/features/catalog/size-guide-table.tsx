"use client";

import { useMemo } from "react";
import type {
  CatalogCategoryOption,
  CatalogSizeGuideListQuery,
  CatalogSizeGuideSummary,
} from "@aaraj/contracts";
import { buttonVariants } from "@/components/ui/button";
import {
  AdminDataTable,
  createDataTableColumnHelper,
} from "@/features/admin/admin-data-table";
import { formatAdminDateTime } from "@/features/admin/admin-date-time";
import Link from "next/link";

const columnHelper = createDataTableColumnHelper<CatalogSizeGuideSummary>();

export function SizeGuideTable({
  guides,
  categoryOptions,
  query,
  onRefresh,
  isRefreshing,
  hasMore,
  nextOffset,
}: {
  guides: CatalogSizeGuideSummary[];
  categoryOptions: CatalogCategoryOption[];
  query: CatalogSizeGuideListQuery;
  onRefresh: () => void;
  isRefreshing?: boolean;
  hasMore: boolean;
  nextOffset: number | null;
}) {
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
          cell: ({ row }) => row.original.category.name,
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
          cell: ({ getValue }) => formatAdminDateTime(getValue()),
        }),
        columnHelper.display({
          id: "actions",
          header: "Actions",
          meta: { align: "right" },
          cell: ({ row }) => (
            <Link
              className={buttonVariants({ size: "lg", variant: "outline" })}
              aria-label={`Edit ${row.original.name}`}
              href={`/admin/catalog/size-guides/${encodeURIComponent(row.original.id)}/edit`}
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
      ariaLabel="Size guides"
      columns={columns}
      data={guides}
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
          options: categoryOptions
            .filter(({ isLeaf }) => isLeaf)
            .map(({ id, path }) => ({ value: id, label: path })),
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
      hasMore={hasMore}
      nextOffset={nextOffset}
    />
  );
}
