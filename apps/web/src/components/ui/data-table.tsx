"use client";

import type { ReactNode } from "react";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const features = tableFeatures({});
type DataTableFeatures = typeof features;

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

type DataTableProps<TData extends RowData & { id: string }> = {
  ariaLabel: string;
  columns: ColumnDef<DataTableFeatures, TData>[];
  data: TData[];
  emptyMessage: ReactNode;
  className?: string;
};

export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData
>;

export function DataTable<TData extends RowData & { id: string }>({
  ariaLabel,
  columns,
  data,
  emptyMessage,
  className,
}: DataTableProps<TData>) {
  const instance = useTable({
    features,
    data,
    columns,
    getRowId: (row) => row.id,
  });
  const rows = instance.getRowModel().rows;

  return (
    <div className={cn("overflow-x-auto rounded-md border", className)}>
      <Table aria-label={ariaLabel} className="min-w-max">
        <TableHeader>
          {instance.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <instance.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <instance.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                className="h-24 whitespace-normal text-center text-muted-foreground"
                colSpan={instance.getAllLeafColumns().length}
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
