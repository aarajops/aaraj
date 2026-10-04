"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CatalogProductFilterOptions,
  CatalogPublishedProductListQuery,
} from "@aaraj/contracts";

interface CatalogFiltersProps {
  options: CatalogProductFilterOptions | null;
  query: CatalogPublishedProductListQuery;
}

interface FilterForm {
  audience: string;
  category: string;
  color: string;
  size: string;
}

export function CatalogFilters({ options, query }: CatalogFiltersProps) {
  const router = useRouter();
  const audience = query.audience ?? "";
  const category = selectedCategoryValue(
    options?.categories ?? [],
    query.category,
  );
  const color = selectedFilterValue(options?.colors ?? [], query.color);
  const size = selectedFilterValue(options?.sizes ?? [], query.size);
  const { control, handleSubmit, reset } = useForm<FilterForm>({
    defaultValues: { audience, category, color, size },
  });
  const selectionKey = [audience, category, color, size].join("\u0000");
  const previousSelectionKey = useRef(selectionKey);
  useEffect(() => {
    if (selectionKey === previousSelectionKey.current) return;
    previousSelectionKey.current = selectionKey;
    reset({ audience, category, color, size });
  }, [audience, category, color, size, reset, selectionKey]);
  const hasActiveFilters = Boolean(
    query.audience || query.category || query.color || query.size,
  );

  function applyFilters(values: FilterForm) {
    const params = new URLSearchParams({ limit: String(query.limit) });
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
    }
    router.push(`/?${params.toString()}`);
  }

  const categoryOptions = (options?.categories ?? []).map((category) => ({
    label: category.path,
    value: category.slug,
  }));

  return (
    <form
      action="/"
      aria-label="Filter products"
      className="mt-8 grid gap-4 rounded-2xl border border-border bg-card/50 p-5 sm:grid-cols-2 lg:grid-cols-4"
      method="get"
      onSubmit={handleSubmit(applyFilters)}
    >
      <input name="limit" type="hidden" value={query.limit} />
      <FilterSelect
        control={control}
        id="filter-audience"
        label="Audience"
        name="audience"
        allLabel="All audiences"
        options={[
          { label: "Men", value: "men" },
          { label: "Women", value: "women" },
          { label: "Unisex", value: "unisex" },
        ]}
      />
      <FilterSelect
        control={control}
        id="filter-category"
        label="Category"
        name="category"
        allLabel="All categories"
        options={categoryOptions}
      />
      <FilterSelect
        control={control}
        id="filter-color"
        label="Color"
        name="color"
        allLabel="All colors"
        options={(options?.colors ?? []).map((color) => ({
          label: color,
          value: color,
        }))}
      />
      <FilterSelect
        control={control}
        id="filter-size"
        label="Size"
        name="size"
        allLabel="All sizes"
        options={(options?.sizes ?? []).map((size) => ({
          label: size,
          value: size,
        }))}
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button className="h-10 px-4" type="submit">
          Apply filters
        </Button>
        {hasActiveFilters && (
          <Link
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

function FilterSelect({
  control,
  id,
  label,
  name,
  allLabel,
  options,
}: {
  control: Control<FilterForm>;
  id: string;
  label: string;
  name: keyof FilterForm;
  allLabel: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <Field>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            items={[{ label: allLabel, value: null }, ...options]}
            name={field.name}
            value={field.value || null}
            onValueChange={(value) =>
              field.onChange(typeof value === "string" ? value : "")
            }
          >
            <SelectTrigger
              id={id}
              aria-labelledby={`${id}-label`}
              ref={field.ref}
              onBlur={field.onBlur}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>{allLabel}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  );
}

function selectedFilterValue(
  values: string[],
  selectedValue: string | undefined,
): string {
  if (!selectedValue) return "";
  const normalized = selectedValue.trim().toLocaleLowerCase("en-US");
  return (
    values.find(
      (value) => value.trim().toLocaleLowerCase("en-US") === normalized,
    ) ?? ""
  );
}

function selectedCategoryValue(
  values: CatalogProductFilterOptions["categories"],
  selectedValue: string | undefined,
): string {
  return selectedValue && values.some(({ slug }) => slug === selectedValue)
    ? selectedValue
    : "";
}
