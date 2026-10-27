"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SortableProvider,
  useSortableItem,
} from "@/components/dnd/sortable-list";
import { GripVertical } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DataTableColumnMeta = {
  align?: "left" | "center" | "right";
  className?: string;
  numeric?: boolean;
};

const features = tableFeatures({
  columnMeta: {} as DataTableColumnMeta,
  rowSelectionFeature,
});
type DataTableFeatures = typeof features;

const alignmentClasses = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

type DataTableProps<TData extends RowData & { id: string }> = {
  ariaLabel: string;
  columns: ColumnDef<DataTableFeatures, TData>[];
  data: TData[];
  emptyMessage: ReactNode;
  className?: string;
  sortableRows?: {
    disabled?: boolean;
    getLabel: (item: TData, index: number) => string;
    onMove: (fromIndex: number, toIndex: number) => void;
  };
};

function SortableDataTableRow({
  id,
  index,
  label,
  disabled,
  selected,
  children,
}: {
  id: string;
  index: number;
  label: string;
  disabled: boolean;
  selected: boolean;
  children: ReactNode;
}) {
  const { ref, handleRef } = useSortableItem(id, index, disabled);

  return (
    <TableRow data-state={selected ? "selected" : undefined} ref={ref}>
      <TableCell className="w-10 px-2">
        <Button
          aria-label={`Reorder ${label}`}
          className="text-muted-foreground"
          disabled={disabled}
          ref={handleRef}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <GripVertical aria-hidden="true" />
        </Button>
      </TableCell>
      {children}
    </TableRow>
  );
}

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
  sortableRows,
}: DataTableProps<TData>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const visibleColumns = useMemo(() => {
    const selectionColumn: ColumnDef<DataTableFeatures, TData> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label={`Select all ${ariaLabel.toLowerCase()} on this page`}
          checked={table.getIsAllPageRowsSelected()}
          disabled={table.getRowModel().rows.length === 0}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(checked) =>
            table.toggleAllPageRowsSelected(checked === true)
          }
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${ariaLabel.toLowerCase()} row ${row.index + 1}`}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
        />
      ),
    };
    return [selectionColumn, ...columns];
  }, [ariaLabel, columns]);
  const instance = useTable({
    features,
    data,
    columns: visibleColumns,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  });
  const rows = instance.getRowModel().rows;

  const table = (
    <Table
      aria-label={ariaLabel}
      scrollRegionLabel={`Scrollable ${ariaLabel.toLowerCase()} table`}
    >
      <TableHeader>
        {instance.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {sortableRows && (
              <TableHead className="w-10 px-2">
                <span className="sr-only">Reorder</span>
              </TableHead>
            )}
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  header.id === "select" && "w-10 px-2",
                  header.column.columnDef.meta?.className,
                  alignmentClasses[
                    header.column.columnDef.meta?.align ?? "left"
                  ],
                  header.column.columnDef.meta?.numeric && "tabular-nums",
                )}
                scope="col"
              >
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
          rows.map((row, index) => {
            const cells = row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cn(
                  cell.column.id === "select" && "w-10 px-2",
                  cell.column.columnDef.meta?.className,
                  alignmentClasses[cell.column.columnDef.meta?.align ?? "left"],
                  cell.column.columnDef.meta?.numeric && "tabular-nums",
                )}
              >
                <instance.FlexRender cell={cell} />
              </TableCell>
            ));
            return sortableRows ? (
              <SortableDataTableRow
                disabled={sortableRows.disabled ?? false}
                id={row.original.id}
                index={index}
                key={row.id}
                label={sortableRows.getLabel(row.original, index)}
                selected={row.getIsSelected()}
              >
                {cells}
              </SortableDataTableRow>
            ) : (
              <TableRow
                data-state={row.getIsSelected() ? "selected" : undefined}
                key={row.id}
              >
                {cells}
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell
              className="h-24 whitespace-normal text-center text-muted-foreground"
              colSpan={
                instance.getAllLeafColumns().length + (sortableRows ? 1 : 0)
              }
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className={className}>
      {sortableRows ? (
        <SortableProvider onMove={sortableRows.onMove}>
          {table}
        </SortableProvider>
      ) : (
        table
      )}
      {instance.getSelectedRowModel().rows.length > 0 && (
        <div
          aria-live="polite"
          className="flex items-center gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground"
          role="status"
        >
          <span>
            {instance.getSelectedRowModel().rows.length} selected on this page
          </span>
          <Button
            className="h-auto px-2 py-1"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => instance.resetRowSelection(true)}
          >
            Clear selection
          </Button>
        </div>
      )}
    </div>
  );
}
