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
  selection,
  children,
}: {
  id: string;
  index: number;
  label: string;
  disabled: boolean;
  selected: boolean;
  selection: ReactNode;
  children: ReactNode;
}) {
  const { ref, handleRef } = useSortableItem(id, index, disabled);

  return (
    <TableRow data-state={selected ? "selected" : undefined} ref={ref}>
      <TableCell className="w-16 px-2">
        <div className="flex items-center gap-1">
          {selection}
          <Button
            aria-label={`Reorder ${label}`}
            className="text-muted-foreground"
            disabled={disabled}
            ref={handleRef}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <GripVertical aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
      {children}
    </TableRow>
  );
}

export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData
>;

function createSelectionColumn<TData extends RowData>(
  ariaLabel: string,
  sortable: boolean,
) {
  const columnHelper = createColumnHelper<DataTableFeatures, TData>();

  return columnHelper.display({
    id: "select",
    meta: { className: sortable ? "w-16 px-2" : "w-10 px-2" },
    header: ({ table }) => (
      <Checkbox
        aria-label={`Select all ${ariaLabel.toLowerCase()} on this page`}
        checked={table.getIsAllPageRowsSelected()}
        disabled={table.getRowModel().rows.length === 0}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`Select row ${row.index + 1} from ${ariaLabel.toLowerCase()}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  });
}

export function DataTable<TData extends RowData & { id: string }>({
  ariaLabel,
  columns,
  data,
  emptyMessage,
  className,
  sortableRows,
}: DataTableProps<TData>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const hasSortableRows = sortableRows !== undefined;
  const selectionColumn = useMemo(
    () => createSelectionColumn<TData>(ariaLabel, hasSortableRows),
    [ariaLabel, hasSortableRows],
  );
  const tableColumns = useMemo(
    () => [selectionColumn, ...columns],
    [columns, selectionColumn],
  );
  const instance = useTable({
    features,
    data,
    columns: tableColumns,
    getRowId: (row) => row.id,
    onRowSelectionChange: setRowSelection,
    state: { rowSelection },
  });
  const rows = instance.getRowModel().rows;
  const selectedCount = instance.getSelectedRowModel().rows.length;

  const table = (
    <Table aria-label={ariaLabel}>
      <TableHeader>
        {instance.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
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
            const rowCells = row.getAllCells();
            const renderCell = (cell: (typeof rowCells)[number]) => (
              <TableCell
                key={cell.id}
                className={cn(
                  cell.column.columnDef.meta?.className,
                  alignmentClasses[cell.column.columnDef.meta?.align ?? "left"],
                  cell.column.columnDef.meta?.numeric && "tabular-nums",
                )}
              >
                <instance.FlexRender cell={cell} />
              </TableCell>
            );
            if (sortableRows) {
              const [selectionCell, ...dataCells] = rowCells;
              return (
                <SortableDataTableRow
                  disabled={sortableRows.disabled ?? false}
                  id={row.original.id}
                  index={index}
                  key={row.id}
                  label={sortableRows.getLabel(row.original, index)}
                  selected={row.getIsSelected()}
                  selection={
                    selectionCell ? (
                      <instance.FlexRender cell={selectionCell} />
                    ) : null
                  }
                >
                  {dataCells.map(renderCell)}
                </SortableDataTableRow>
              );
            }

            return (
              <TableRow
                data-state={row.getIsSelected() ? "selected" : undefined}
                key={row.id}
              >
                {rowCells.map(renderCell)}
              </TableRow>
            );
          })
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
      {selectedCount > 0 && (
        <p
          aria-live="polite"
          className="px-4 pb-3 text-sm text-muted-foreground"
          role="status"
        >
          {selectedCount} {selectedCount === 1 ? "row" : "rows"} selected
        </p>
      )}
    </div>
  );
}
