"use client";

import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import {
  isSortable,
  useSortable as useDndKitSortable,
} from "@dnd-kit/react/sortable";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

type SortableListItemProps<T> = {
  id: string;
  index: number;
  label: string;
  className?: string;
  disabled?: boolean;
  item: T;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
};

export function SortableProvider({
  children,
  onMove,
}: {
  children: ReactNode;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;

        const { source } = event.operation;
        if (!isSortable(source)) return;

        const { initialIndex, index } = source;
        if (initialIndex !== index) onMove(initialIndex, index);
      }}
    >
      {children}
    </DragDropProvider>
  );
}

export function useSortableItem(id: string, index: number, disabled = false) {
  return useDndKitSortable({ id, index, disabled });
}

function SortableListItem<T>({
  id,
  index,
  label,
  className,
  disabled,
  item,
  renderItem,
}: SortableListItemProps<T>) {
  const { ref, handleRef } = useSortableItem(id, index, disabled);

  return (
    <li className={className} ref={ref}>
      {renderItem(
        item,
        index,
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
        </Button>,
      )}
    </li>
  );
}

export function SortableList<T>({
  ariaLabel,
  items,
  getItemId,
  getItemLabel,
  onMove,
  className,
  itemClassName,
  disabled = false,
  renderItem,
}: {
  ariaLabel: string;
  items: readonly T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T, index: number) => string;
  onMove: (fromIndex: number, toIndex: number) => void;
  className?: string;
  itemClassName?: string;
  disabled?: boolean;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
}) {
  return (
    <SortableProvider onMove={onMove}>
      <ol aria-label={ariaLabel} className={className}>
        {items.map((item, index) => (
          <SortableListItem
            className={itemClassName}
            disabled={disabled}
            id={getItemId(item)}
            index={index}
            item={item}
            key={getItemId(item)}
            label={getItemLabel(item, index)}
            renderItem={renderItem}
          />
        ))}
      </ol>
    </SortableProvider>
  );
}
