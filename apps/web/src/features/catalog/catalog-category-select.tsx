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
  allowParentCategories = false,
  required = false,
  errorMessage,
  name,
  triggerRef,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  allowParentCategories?: boolean;
  required?: boolean;
  errorMessage?: string;
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
        setCategories(result.data.categories);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const selectableCategories = allowParentCategories
    ? categories
    : categories.filter(({ isLeaf }) => isLeaf);
  const emptyLabel =
    loadState === "loading"
      ? "Loading categories…"
      : selectableCategories.length
        ? "Choose a category"
        : allowParentCategories
          ? "No active categories available"
          : "No active product categories available";

  return (
    <Field>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        disabled={loadState !== "ready" || selectableCategories.length === 0}
        items={[
          { label: emptyLabel, value: null },
          ...selectableCategories.map((category) => ({
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
          aria-describedby={
            [
              errorMessage ? `${id}-error` : null,
              loadState === "error" ? `${id}-load-error` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={Boolean(errorMessage)}
          ref={triggerRef}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{emptyLabel}</SelectItem>
          {selectableCategories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMessage && (
        <FieldError id={`${id}-error`}>{errorMessage}</FieldError>
      )}
      {loadState === "error" && (
        <FieldError id={`${id}-load-error`}>
          Categories could not be loaded. Try again later.
        </FieldError>
      )}
      {loadState === "ready" && selectableCategories.length === 0 && (
        <FieldDescription>
          {allowParentCategories
            ? "An administrator needs to add an active category before this guide can be assigned."
            : "An administrator needs to add an active leaf category before this product can be assigned."}
        </FieldDescription>
      )}
      {allowParentCategories &&
        loadState === "ready" &&
        selectableCategories.length > 0 && (
          <FieldDescription>
            A guide is available for products in this category and its
            subcategories.
          </FieldDescription>
        )}
    </Field>
  );
}
