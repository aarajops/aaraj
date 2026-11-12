"use client";

import { Trash2 } from "lucide-react";
import type { CatalogCategoryOption } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { SortableList } from "@/components/dnd/sortable-list";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function HomepageCategorySettings({
  categories,
  selectedCategoryIds,
  enabled,
  disabled = false,
  onEnabledChange,
  onCategoryAdd,
  onCategoryRemove,
  onCategoryMove,
}: {
  categories: CatalogCategoryOption[];
  selectedCategoryIds: string[];
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onCategoryAdd: (categoryId: string) => void;
  onCategoryRemove: (categoryId: string) => void;
  onCategoryMove: (fromIndex: number, toIndex: number) => void;
}) {
  const selectedIds = new Set(selectedCategoryIds);
  const categoryPaths = new Map(categories.map(({ id, path }) => [id, path]));
  const availableCategories = categories.filter(
    ({ id }) => !selectedIds.has(id),
  );
  const selectedCategories = selectedCategoryIds.map((id) => ({
    id,
    path: categoryPaths.get(id) ?? "Unavailable category",
  }));

  return (
    <section className="grid gap-4">
      <Field className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <Switch
          id="homepage-categories-enabled"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
        <FieldLabel htmlFor="homepage-categories-enabled">
          Show on homepage
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor="homepage-category-select">Add category</FieldLabel>
        <Select
          value={null}
          disabled={disabled || availableCategories.length === 0}
          onValueChange={(categoryId) => {
            if (categoryId) onCategoryAdd(categoryId);
          }}
        >
          <SelectTrigger id="homepage-category-select">
            <SelectValue
              placeholder={
                availableCategories.length > 0
                  ? "Choose a category…"
                  : categories.length > 0
                    ? "All active categories are selected"
                    : "No active categories available"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availableCategories.map(({ id, path }) => (
              <SelectItem key={id} value={id}>
                {path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Categories without artwork appear as text tiles.
        </FieldDescription>
      </Field>
      {selectedCategories.length > 0 ? (
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-medium">Display order</h3>
            <p className="text-xs text-muted-foreground">
              Drag categories to reorder them.
            </p>
          </div>
          <SortableList
            ariaLabel="Homepage category display order"
            className="grid gap-2"
            getItemId={({ id }) => id}
            getItemLabel={({ path }, index) => `${path}, position ${index + 1}`}
            itemClassName="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            items={selectedCategories}
            onMove={onCategoryMove}
            disabled={disabled}
            renderItem={({ id, path }, _index, handle) => (
              <>
                <span className="min-w-0 flex-1 truncate">{path}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {handle}
                  <Button
                    aria-label={`Remove ${path} from homepage`}
                    title={`Remove ${path} from homepage`}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={disabled}
                    onClick={() => onCategoryRemove(id)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </>
            )}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No homepage categories selected.
        </p>
      )}
    </section>
  );
}
