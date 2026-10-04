"use client";

import {
  CatalogCategoryOptionsSchema,
  type CatalogCategoryOption,
} from "@aaraj/contracts";
import { useEffect, useState } from "react";
import { fetchCatalogCategories } from "@/features/catalog/catalog-client";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";

export function CatalogCategorySelect({
  id,
  label,
  value,
  required = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  onChange: (categoryId: string) => void;
}) {
  const [categories, setCategories] = useState<CatalogCategoryOption[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    void fetchCatalogCategories()
      .then(async (response) => {
        if (!response.ok) throw new Error("Category options unavailable");
        const result = CatalogCategoryOptionsSchema.safeParse(
          await response.json(),
        );
        if (!result.success) throw new Error("Invalid category options");
        if (!active) return;
        setCategories(result.data.categories.filter(({ isLeaf }) => isLeaf));
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <label className="block space-y-2 text-sm font-medium" htmlFor={id}>
      {label}
      <select
        className={fieldClassName}
        disabled={loadState !== "ready" || categories.length === 0}
        id={id}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {loadState === "loading"
            ? "Loading categories…"
            : categories.length
              ? "Choose a category"
              : "No product categories available"}
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.path}
          </option>
        ))}
      </select>
      {loadState === "error" && (
        <span
          className="block text-xs font-normal text-destructive"
          role="alert"
        >
          Product categories could not be loaded. Try again later.
        </span>
      )}
      {loadState === "ready" && categories.length === 0 && (
        <span className="block text-xs font-normal text-muted-foreground">
          An administrator needs to add an active leaf category before this item
          can be assigned.
        </span>
      )}
    </label>
  );
}
