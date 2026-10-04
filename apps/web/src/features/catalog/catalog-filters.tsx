"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
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
  const { register, handleSubmit, reset } = useForm<FilterForm>({
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

  return (
    <form
      action="/"
      aria-label="Filter products"
      className="mt-8 grid gap-4 rounded-2xl border border-border bg-card/50 p-5 sm:grid-cols-2 lg:grid-cols-4"
      method="get"
      onSubmit={handleSubmit(applyFilters)}
    >
      <input name="limit" type="hidden" value={query.limit} />
      <Field>
        <FieldLabel htmlFor="filter-audience">Audience</FieldLabel>
        <NativeSelect id="filter-audience" {...register("audience")}>
          <option value="">All audiences</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
          <option value="unisex">Unisex</option>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-category">Category</FieldLabel>
        <NativeSelect id="filter-category" {...register("category")}>
          <option value="">All categories</option>
          {(options?.categories ?? []).map((category) => (
            <option key={category.id} value={category.slug}>
              {category.path}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-color">Color</FieldLabel>
        <NativeSelect id="filter-color" {...register("color")}>
          <option value="">All colors</option>
          {(options?.colors ?? []).map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="filter-size">Size</FieldLabel>
        <NativeSelect id="filter-size" {...register("size")}>
          <option value="">All sizes</option>
          {(options?.sizes ?? []).map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </NativeSelect>
      </Field>
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
