"use client";

import Link from "next/link";
import type { CatalogCategoryOption } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
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
  onEnabledChange,
  onCategoryAdd,
  onCategoryRemove,
}: {
  categories: CatalogCategoryOption[];
  selectedCategoryIds: string[];
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onCategoryAdd: (categoryId: string) => void;
  onCategoryRemove: (categoryId: string) => void;
}) {
  const selectedIds = new Set(selectedCategoryIds);
  const availableIds = new Set(categories.map(({ id }) => id));
  const artworkCategories = categories.filter(({ image }) => Boolean(image));
  const availableCategories = artworkCategories.filter(
    ({ id }) => !selectedIds.has(id),
  );
  const selectedCategories = [
    ...categories
      .filter(({ id }) => selectedIds.has(id))
      .map(({ id, path }) => ({ id, path })),
    ...selectedCategoryIds
      .filter((id) => !availableIds.has(id))
      .map((id) => ({ id, path: "Unavailable category" })),
  ];

  return (
    <section
      aria-labelledby="homepage-categories-heading"
      className="grid gap-5 border-t border-border pt-6"
    >
      <div>
        <h3 className="text-lg font-semibold" id="homepage-categories-heading">
          Homepage categories
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Show selected categories with artwork and published products. Their
          order follows the catalog.
        </p>
      </div>
      <Field className="flex items-center gap-3">
        <Switch
          id="homepage-categories-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
        <FieldLabel htmlFor="homepage-categories-enabled">
          Show on homepage
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor="homepage-category-select">Categories</FieldLabel>
        <Select
          value={null}
          disabled={availableCategories.length === 0}
          onValueChange={(categoryId) => {
            if (categoryId) onCategoryAdd(categoryId);
          }}
        >
          <SelectTrigger id="homepage-category-select">
            <SelectValue
              placeholder={
                artworkCategories.length === 0
                  ? "No category artwork available"
                  : "All artwork categories are selected"
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
          Add artwork from{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/admin/catalog/categories"
          >
            catalog categories
          </Link>
          .
        </FieldDescription>
        {selectedCategories.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {selectedCategories.map(({ id, path }) => (
              <li
                className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
                key={id}
              >
                <span>{path}</span>
                <Button
                  aria-label={`Remove ${path} from homepage`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCategoryRemove(id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Field>
    </section>
  );
}
