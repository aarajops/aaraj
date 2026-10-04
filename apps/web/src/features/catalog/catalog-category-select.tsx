"use client";

import {
  CatalogCategoryOptionsSchema,
  type CatalogCategoryOption,
} from "@aaraj/contracts";
import { useEffect, useState, type Ref } from "react";
import { fetchCatalogCategories } from "@/features/catalog/catalog-client";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";

export function CatalogCategorySelect({
  id,
  label,
  value,
  required = false,
  name,
  triggerRef,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  name?: string;
  triggerRef?: Ref<HTMLButtonElement>;
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

  const emptyLabel =
    loadState === "loading"
      ? "Loading categories…"
      : categories.length
        ? "Choose a category"
        : "No product categories available";

  return (
    <Field>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        disabled={loadState !== "ready" || categories.length === 0}
        items={[
          { label: emptyLabel, value: null },
          ...categories.map((category) => ({
            label: category.path,
            value: category.id,
          })),
        ]}
        name={name}
        required={required}
        value={value || null}
        onValueChange={(selectedValue) =>
          onChange(typeof selectedValue === "string" ? selectedValue : "")
        }
      >
        <SelectTrigger
          className={fieldClassName}
          id={id}
          aria-labelledby={`${id}-label`}
          ref={triggerRef}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{emptyLabel}</SelectItem>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
