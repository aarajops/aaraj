"use client";

import { Trash2 } from "lucide-react";
import type {
  CatalogManagedCategory,
  CatalogPublishedCategoryOption,
} from "@aaraj/contracts";
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

type SelectedCategory = {
  id: string;
  path: string;
  status: string;
};

export function HomepageCategorySettings({
  categories,
  publishedCategories,
  selectedCategoryIds,
  enabled,
  disabled = false,
  onEnabledChange,
  onCategoryAdd,
  onCategoryRemove,
  onCategoryMove,
}: {
  categories: CatalogManagedCategory[];
  publishedCategories: CatalogPublishedCategoryOption[] | null;
  selectedCategoryIds: string[];
  enabled: boolean;
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onCategoryAdd: (categoryId: string) => void;
  onCategoryRemove: (categoryId: string) => void;
  onCategoryMove: (fromIndex: number, toIndex: number) => void;
}) {
  const selectedIds = new Set(selectedCategoryIds);
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const publishedCounts = new Map(
    (publishedCategories ?? []).map(({ id, publishedProductCount }) => [
      id,
      publishedProductCount,
    ]),
  );
  const activeCategories = categories.filter(({ isActive }) => isActive);
  const availableCategories = activeCategories.filter(
    ({ id }) => !selectedIds.has(id),
  );
  const selectedCategories: SelectedCategory[] = selectedCategoryIds.map(
    (id) => {
      const category = categoriesById.get(id);
      const publishedProductCount = publishedCategories
        ? (publishedCounts.get(id) ?? 0)
        : null;
      const status = !category
        ? "Unavailable category"
        : !category.isActive
          ? "Inactive · hidden from shoppers"
          : publishedProductCount === null
            ? "Product count unavailable"
            : publishedProductCount === 0
              ? "Not shown until it has published products"
              : `${publishedProductCount} ${publishedProductCount === 1 ? "product" : "products"} · eligible to show`;

      return {
        id,
        path: category?.path ?? `Unavailable category (${id.slice(0, 8)})`,
        status,
      };
    },
  );

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
          Show featured categories on homepage
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
                  : activeCategories.length > 0
                    ? "All active categories are selected"
                    : "No active categories available"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availableCategories.map(({ id, path }) => {
              const count = publishedCategories
                ? (publishedCounts.get(id) ?? 0)
                : null;
              const label =
                count === null
                  ? path
                  : count === 0
                    ? `${path} · no published products yet`
                    : `${path} · ${count} ${count === 1 ? "product" : "products"}`;

              return (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <FieldDescription>
          Active categories with no published products stay selected but are
          hidden from shoppers until products are published. Artwork is
          optional; cards use a placeholder when it is missing.
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
            ariaLabel="Featured category display order"
            className="grid gap-2"
            getItemId={({ id }) => id}
            getItemLabel={({ path, status }, index) =>
              `${path}, ${status}, position ${index + 1}`
            }
            itemClassName="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            items={selectedCategories}
            onMove={onCategoryMove}
            disabled={disabled}
            renderItem={({ id, path, status }, _index, handle) => (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{path}</span>
                  <span className="block text-xs text-muted-foreground">
                    {status}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {handle}
                  <Button
                    aria-label={`Remove ${path} from featured categories`}
                    title={`Remove ${path} from featured categories`}
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
          No featured categories selected.
        </p>
      )}
    </section>
  );
}
