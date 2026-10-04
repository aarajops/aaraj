"use client";

import {
  CatalogCategoryOptionsSchema,
  type CatalogCategoryOption,
} from "@aaraj/contracts";
import { useEffect, useState, type Ref } from "react";
import { fetchCatalogCategories } from "@/features/catalog/catalog-client";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";

export function CatalogCategorySelect({
  id,
  label,
  value,
  required = false,
  name,
  inputRef,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  name?: string;
  inputRef?: Ref<HTMLSelectElement>;
  onBlur?: () => void;
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
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        className={fieldClassName}
        disabled={loadState !== "ready" || categories.length === 0}
        id={id}
        name={name}
        ref={inputRef}
        required={required}
        value={value}
        onBlur={onBlur}
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
      </NativeSelect>
      {loadState === "error" && (
        <FieldError>
          Product categories could not be loaded. Try again later.
        </FieldError>
      )}
      {loadState === "ready" && categories.length === 0 && (
        <FieldDescription>
          An administrator needs to add an active leaf category before this item
          can be assigned.
        </FieldDescription>
      )}
    </Field>
  );
}
